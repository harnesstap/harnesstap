import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { isProfilePlugin } from "../../constants/profile.js";
import {
  getPluginById,
  mergePluginsById,
  resolvePluginSelector,
} from "../../models/plugin-model.js";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
} from "../../models/harness.js";
import {
  applyConfiguredPluginToProject,
  getProjectByLocalPath,
  upsertProject,
} from "../../models/project.js";
import { createSnapshot } from "../../models/snapshot.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "../../services/git.js";
import {
  generateFiles,
  materializeFiles,
  planMaterializationConflicts,
} from "../../services/applier.js";
import { persistWrittenMaterializations } from "../../services/materialization-ownership.js";
import { collectPluginPinsForPrepare, preparePluginPinsForApply } from "../../services/plugin-pin-apply.js";
import { resolveComposition } from "../../services/resolve/index.js";
import { resolveEnvironmentCascadeForApply } from "../../services/environment-cascade.js";
import { substituteResourcesForApply } from "../../services/environment-var-substitution.js";
import { resolveApplySelectorsFromProjectManifest } from "../../services/apm-project-plugin.js";
import {
  lockfileFromResolution,
  lockIsUsable,
  lockedVersionsFrom,
  readLockfile,
  writeLockfile,
  type ApmGitLockFields,
} from "../../services/lockfile.js";
import { gateDeployFiles, LockIntegrityError } from "../../services/deploy-gate.js";
import { CriticalUnicodeError } from "../../services/unicode-scan.js";
import {
  assertPolicyAllowsApply,
  evaluateApplyPolicy,
  PolicyError,
} from "../../services/apm-policy.js";
import {
  applyExecutableTrustGate,
  executableTrustResponseFields,
  overlappingDeployedHashes,
} from "../../services/executable-trust.js";
import { findProjectConfig } from "../../services/project-config.js";
import { detectProfileOwnedOverwriteConflicts } from "../../services/profile-owned-overwrite.js";
import { applyProfilePlugin } from "../../services/profile-apply.js";
import { withProfileApplyLock } from "../../services/profile-apply-lock.js";
import { useProfileCommand } from "../../services/profile-commands.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  uniqueHarnessTargets,
} from "../../services/harness-targets.js";
import { detectPlatforms } from "../../services/scanner.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import type { SnapshotState } from "../../types.js";
import {
  SingletonConflictError,
  UnsatisfiableConstraintError,
} from "../../services/resolve/types.js";

let applyInFlight = false;

export function isAgentApplyInProgress(): boolean {
  return applyInFlight;
}

export function resetAgentApplyInProgressForTests(): void {
  applyInFlight = false;
}

export function setAgentApplyInProgressForTests(value: boolean): void {
  applyInFlight = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ApplyScope = "home" | "project";
type OnConflict = "replace" | "skip";

interface ParsedApplyBody {
  plugins: string[];
  scope: ApplyScope;
  projectPath?: string;
  onConflict: OnConflict;
  dryRun: boolean;
  confirmOwnedOverwrite: boolean;
  harness?: string;
  force?: boolean;
  update?: boolean;
}

function parseBody(body: unknown): ParsedApplyBody | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body", message: "Body must be a JSON object" }, { status: 400 });
  }
  if (body.scope === "both") {
    return jsonResponse(
      { error: "invalid_scope", message: "scope must be home or project" },
      { status: 400 },
    );
  }
  if (body.scope !== "home" && body.scope !== "project") {
    return jsonResponse(
      { error: "invalid_scope", message: "scope must be home or project" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.plugins)) {
    return jsonResponse(
      { error: "invalid_plugins", message: "plugins must be an array of strings" },
      { status: 400 },
    );
  }
  const plugins: string[] = [];
  for (const entry of body.plugins) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return jsonResponse(
        { error: "invalid_plugins", message: "plugins must be an array of strings" },
        { status: 400 },
      );
    }
    plugins.push(entry.trim());
  }
  if (body.scope === "home" && plugins.length !== 1) {
    return jsonResponse(
      {
        error: "invalid_plugins",
        message: "Global apply accepts exactly one plugin.",
      },
      { status: 400 },
    );
  }
  const onConflict = body.onConflict === undefined ? "replace" : body.onConflict;
  if (onConflict !== "replace" && onConflict !== "skip") {
    return jsonResponse(
      { error: "invalid_body", message: "onConflict must be replace or skip" },
      { status: 400 },
    );
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    return jsonResponse({ error: "invalid_body", message: "dryRun must be a boolean" }, { status: 400 });
  }
  if (
    body.confirmOwnedOverwrite !== undefined
    && typeof body.confirmOwnedOverwrite !== "boolean"
  ) {
    return jsonResponse(
      { error: "invalid_body", message: "confirmOwnedOverwrite must be a boolean" },
      { status: 400 },
    );
  }
  if (body.harness !== undefined && typeof body.harness !== "string") {
    return jsonResponse({ error: "invalid_body", message: "harness must be a string" }, { status: 400 });
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return jsonResponse({ error: "invalid_body", message: "force must be a boolean" }, { status: 400 });
  }
  if (body.update !== undefined && typeof body.update !== "boolean") {
    return jsonResponse({ error: "invalid_body", message: "update must be a boolean" }, { status: 400 });
  }
  if (body.projectPath !== undefined && typeof body.projectPath !== "string") {
    return jsonResponse(
      { error: "invalid_body", message: "projectPath must be a string" },
      { status: 400 },
    );
  }
  if (body.scope === "project" && (!body.projectPath || body.projectPath.trim().length === 0)) {
    return jsonResponse(
      {
        error: "missing_project_path",
        message: "projectPath is required when scope is project",
      },
      { status: 400 },
    );
  }

  return {
    plugins,
    scope: body.scope,
    onConflict,
    dryRun: body.dryRun === true,
    confirmOwnedOverwrite: body.confirmOwnedOverwrite === true,
    ...(body.projectPath?.trim() ? { projectPath: body.projectPath.trim() } : {}),
    ...(body.harness?.trim() ? { harness: body.harness.trim() } : {}),
    ...(body.force === true ? { force: true } : {}),
    ...(body.update === true ? { update: true } : {}),
  };
}

function resolveProjectHarnesses(projectRoot: string, harnessOption?: string): string[] {
  const explicit = uniqueHarnessTargets(parsePlatformFilter(harnessOption) ?? []);
  if (explicit.length > 0) {
    assertSupportedHarnessTargets(explicit);
    return explicit;
  }
  const manifest = findProjectConfig(projectRoot);
  if (manifest && manifest.harnessTargets.length > 0) {
    const mapped = uniqueHarnessTargets(manifest.harnessTargets);
    assertSupportedHarnessTargets(mapped);
    return mapped;
  }
  const projectByPath = getProjectByLocalPath(projectRoot);
  const projectConfig = projectByPath
    ? getProjectHarnessConfig(projectByPath.id)
    : undefined;
  if (projectConfig) {
    const preferred = uniqueHarnessTargets([
      projectConfig.main_harness,
      ...projectConfig.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferred);
    return preferred;
  }
  const preference = getHarnessPreference();
  if (preference) {
    const preferred = uniqueHarnessTargets([
      preference.main_harness,
      ...preference.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferred);
    return preferred;
  }
  return uniqueHarnessTargets(detectPlatforms(projectRoot));
}

async function ownedOverwriteSummary(
  selector: string,
  harness?: string,
): Promise<{ paths: string[]; conflicts: unknown[] }> {
  const plugin = resolvePluginSelector(selector);
  if (plugin && isProfilePlugin(plugin)) {
    return detectProfileOwnedOverwriteConflicts(selector, harness ? { harness } : {});
  }
  const preview = await applyProfilePlugin(selector, {
    dryRun: true,
    conflictPolicy: "prompt",
    recordActiveProfile: false,
    ...(harness ? { harness } : {}),
  });
  if (!preview.expected_files || preview.expected_files.length === 0) {
    return { paths: [], conflicts: [] };
  }
  const planned = await planMaterializationConflicts(
    preview.expected_files.map((file) => ({ path: file.path, content: file.content })),
    resolveHomeRoot(),
  );
  const owned = planned.filter((conflict) => conflict.owners.length > 0);
  return {
    paths: owned.map((conflict) => conflict.path),
    conflicts: owned.map((conflict) => ({
      path: conflict.path,
      owners: conflict.owners,
    })),
  };
}

async function executeHomeApply(parsed: ParsedApplyBody): Promise<Response> {
  const selector = parsed.plugins[0];
  if (!selector) {
    return jsonResponse(
      { error: "invalid_plugins", message: "Global apply accepts exactly one plugin." },
      { status: 400 },
    );
  }
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    return jsonResponse(
      { error: "plugin_not_found", message: `Plugin not found: ${selector}` },
      { status: 404 },
    );
  }

  if (parsed.onConflict === "replace" && !parsed.dryRun && !parsed.confirmOwnedOverwrite) {
    const summary = await ownedOverwriteSummary(selector, parsed.harness);
    if (summary.paths.length > 0) {
      return jsonResponse(
        {
          error: "owned_overwrite_confirmation_required",
          message:
            "Owned-path conflicts would be replaced. Set confirmOwnedOverwrite to proceed.",
          conflicts: summary,
        },
        { status: 409 },
      );
    }
  }

  const applyOptions = {
    dryRun: parsed.dryRun,
    conflictPolicy: parsed.onConflict,
    ...(parsed.harness ? { harness: parsed.harness } : {}),
    ...(parsed.force ? { forceUnicode: true } : {}),
  };

  const payload = isProfilePlugin(plugin)
    ? await useProfileCommand(selector, applyOptions)
    : await withProfileApplyLock(() =>
        applyProfilePlugin(selector, {
          ...applyOptions,
          recordActiveProfile: false,
        }),
      );

  if (payload.cancelled) {
    return jsonResponse(
      { error: "apply_failed", message: "Apply cancelled.", scope: "home", ...payload },
      { status: 400 },
    );
  }

  return jsonResponse({ scope: "home", ...payload });
}

async function executeProjectApply(parsed: ParsedApplyBody): Promise<Response> {
  const projectRoot = parsed.projectPath;
  if (!projectRoot) {
    return jsonResponse(
      { error: "missing_project_path", message: "projectPath is required when scope is project" },
      { status: 400 },
    );
  }

  let pluginIds = parsed.plugins;
  let manifestGitLocks: ApmGitLockFields[] = [];
  if (pluginIds.length === 0) {
    const fromManifest = await resolveApplySelectorsFromProjectManifest(projectRoot, {
      dryRun: parsed.dryRun,
      update: parsed.update,
    });
    if (!fromManifest || fromManifest.selectors.length === 0) {
      return jsonResponse(
        {
          error: "invalid_plugins",
          message:
            "plugins must be a non-empty array of strings, or declare plugins in apm.yml.",
        },
        { status: 400 },
      );
    }
    pluginIds = fromManifest.selectors;
    manifestGitLocks = fromManifest.gitLocks;
  }

  for (const selector of pluginIds) {
    if (!resolvePluginSelector(selector)) {
      return jsonResponse(
        { error: "plugin_not_found", message: `Plugin not found: ${selector}` },
        { status: 404 },
      );
    }
  }

  const existingLock = parsed.update ? undefined : readLockfile(projectRoot);
  const primaryName = pluginIds[0] ?? "";
  const lockedVersions =
    existingLock && lockIsUsable(existingLock, primaryName)
      ? lockedVersionsFrom(existingLock)
      : undefined;

  const rootPluginIds = pluginIds.map((selector) => {
    const plugin = resolvePluginSelector(selector);
    if (!plugin) {
      throw new Error(`Plugin not found: ${selector}`);
    }
    return plugin.id;
  });
  const rootPluginPins = collectPluginPinsForPrepare(rootPluginIds);
  if (rootPluginPins.length > 0) {
    await preparePluginPinsForApply({
      pins: rootPluginPins,
      baseResources: [],
      projectRoot,
      claudeConfig: mergePluginsById(rootPluginIds).claude,
      skipSync: false,
      ignoreMissingInstall: parsed.dryRun,
    });
  }

  const resolution = resolveComposition({
    rootSelectors: pluginIds,
    ...(lockedVersions ? { lockedVersions } : {}),
  });
  const configuredPluginIds = resolution.selected.map((row) => row.pluginId);
  const plugins = configuredPluginIds
    .map((id) => getPluginById(id))
    .filter((plugin): plugin is NonNullable<typeof plugin> => plugin != null);
  const primaryPlugin = plugins[0];
  if (!primaryPlugin) {
    return jsonResponse(
      { error: "apply_failed", message: "No plugin resolved for apply" },
      { status: 400 },
    );
  }

  const platforms = resolveProjectHarnesses(projectRoot, parsed.harness);
  if (platforms.length === 0) {
    return jsonResponse(
      {
        error: "apply_failed",
        message:
          "No harness targets configured. Run harnesstap harness set or pass harness slugs.",
      },
      { status: 400 },
    );
  }

  const resolvedEnvironment = resolveEnvironmentCascadeForApply({ configuredPluginIds });
  const substituted = substituteResourcesForApply(resolution.resources, resolvedEnvironment.vars);
  const manifestForPolicy = findProjectConfig(projectRoot);
  try {
    assertPolicyAllowsApply(
      evaluateApplyPolicy({
        projectRoot,
        resolution,
        resources: substituted.resources,
        apmDependencies: manifestForPolicy?.apmDependencies,
        mcpDependencies: manifestForPolicy?.mcpDependencies,
        gitLocks: manifestGitLocks,
        ...(manifestForPolicy?.policyPin ? { pin: manifestForPolicy.policyPin } : {}),
      }),
    );
  } catch (err) {
    if (err instanceof PolicyError) {
      return jsonResponse(
        { error: "policy_blocked", message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }
  const executableTrust = applyExecutableTrustGate({
    projectRoot,
    resolution,
    resources: substituted.resources,
    gitLocks: manifestGitLocks,
  });
  const generated = await generateFiles(executableTrust.resources, platforms, projectRoot, {
    claudeConfig: mergePluginsById(configuredPluginIds).claude,
    resolvedEnvironment,
    skillSourceRoot: projectRoot,
  });

  const generatedFiles = generated.flatMap((result) =>
    result.files.map((file) => ({ path: file.path, content: file.content })),
  );
  const shouldVerifyHashes = Boolean(
    !parsed.update &&
      existingLock &&
      lockIsUsable(existingLock, primaryName) &&
      existingLock.deployed_file_hashes &&
      Object.keys(existingLock.deployed_file_hashes).length > 0,
  );
  try {
    const expectedHashes = existingLock?.deployed_file_hashes;
    gateDeployFiles(generatedFiles, {
      forceUnicode: parsed.force,
      verifyHashes: shouldVerifyHashes,
      expectedHashes:
        executableTrust.optedIn && expectedHashes
          ? overlappingDeployedHashes(expectedHashes, generatedFiles)
          : expectedHashes,
    });
  } catch (err) {
    if (err instanceof CriticalUnicodeError || err instanceof LockIntegrityError) {
      return jsonResponse(
        { error: "apply_blocked", message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  if (parsed.dryRun) {
    return jsonResponse({
      scope: "project",
      plugin: primaryPlugin.name,
      plugins: pluginIds,
      project_root: projectRoot,
      platforms: generated.map((result) => ({
        platform: result.platformId,
        files: result.files.map((file) => ({ path: file.path })),
      })),
      ...executableTrustResponseFields(executableTrust),
    });
  }

  if (!resolution.root.ephemeral) {
    const manifest = findProjectConfig(projectRoot);
    writeLockfile(
      projectRoot,
      lockfileFromResolution(resolution, {
        ...(manifest?.default_environment
          ? { environment: manifest.default_environment }
          : {}),
        deployedFiles: generated.flatMap((result) =>
          result.files.map((file) => ({ path: file.path, content: file.content })),
        ),
        ...(manifestGitLocks.length > 0 ? { gitLocks: manifestGitLocks } : {}),
        ...(executableTrust.optedIn ? { execStatuses: executableTrust.execStatuses } : {}),
      }),
    );
  }

  const gitOrigin = getGitOrigin(projectRoot);
  // Ephemeral multi-plugin roots are deleted when resolveComposition returns,
  // so skip project-config binding (CLI uses a still-live bundle id).
  let trackedProjectId: string | undefined;
  if (gitOrigin && !resolution.root.ephemeral) {
    const project = upsertProject({
      git_origin: normalizeGitUrl(gitOrigin),
      name: projectNameFromUrl(gitOrigin),
      local_path: projectRoot,
    });
    trackedProjectId = project.id;
    const snapshotState: SnapshotState = {
      plugins,
      resources: substituted.resources,
      platform_files: Object.fromEntries(
        generated.map((result) => [
          result.platformId,
          Object.fromEntries(result.files.map((file) => [file.path, file.content])),
        ]),
      ),
    };
    createSnapshot({
      project_id: project.id,
      label:
        parsed.plugins.length > 1
          ? `Before applying: ${parsed.plugins.join(" + ")}`
          : `Before applying: ${primaryPlugin.name}`,
      state: snapshotState,
    });
    applyConfiguredPluginToProject({
      project_id: project.id,
      configured_plugin_id: resolution.root.pluginId,
      platforms,
    });
  }

  const platformResults = [];
  for (const result of generated) {
    const materialized = await materializeFiles(result.files, projectRoot, {
      conflictPolicy: parsed.onConflict,
    });
    if (!materialized.cancelled) {
      persistWrittenMaterializations({
        scope: "project",
        project_id: trackedProjectId ?? null,
        root_path: projectRoot,
        platformResults: [{
          platformId: result.platformId,
          files: result.files,
          writtenPaths: materialized.writtenFiles,
        }],
      });
    }
    platformResults.push({
      platform: result.platformId,
      written_files: materialized.writtenFiles,
      skipped_files: materialized.skippedFiles,
    });
  }

  return jsonResponse({
    scope: "project",
    plugin: primaryPlugin.name,
    plugins: parsed.plugins,
    project_root: projectRoot,
    platforms: platformResults,
    cancelled: false,
    ...executableTrustResponseFields(executableTrust),
  });
}

function mapApplyError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (/plugin not found/i.test(message)) {
    return jsonResponse({ error: "plugin_not_found", message }, { status: 404 });
  }
  if (
    error instanceof UnsatisfiableConstraintError
    || error instanceof SingletonConflictError
  ) {
    return jsonResponse({ error: "apply_failed", message }, { status: 400 });
  }
  if (error instanceof PolicyError) {
    return jsonResponse({ error: "policy_blocked", message }, { status: 400 });
  }
  return jsonResponse({ error: "apply_failed", message }, { status: 400 });
}

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/apply") {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (parsed instanceof Response) {
    return parsed;
  }

  if (deps.isAgentSwitchInProgress()) {
    return jsonResponse(
      { error: "switch_in_progress", message: "Another profile switch is already running" },
      { status: 409 },
    );
  }
  if (applyInFlight) {
    return jsonResponse(
      { error: "apply_in_progress", message: "Another apply is already running" },
      { status: 409 },
    );
  }

  applyInFlight = true;
  try {
    switch (parsed.scope) {
      case "home":
        return await executeHomeApply(parsed);
      case "project":
        return await executeProjectApply(parsed);
      default: {
        const _exhaustive: never = parsed.scope;
        return jsonResponse(
          { error: "invalid_scope", message: String(_exhaustive) },
          { status: 400 },
        );
      }
    }
  } catch (error) {
    return mapApplyError(error);
  } finally {
    applyInFlight = false;
  }
}
