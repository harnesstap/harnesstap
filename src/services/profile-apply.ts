import {
  heldFolderOf,
  holdsOnlyLeavingHarnessTapRegistrations,
  isClaudePluginRegistryPath,
  planStaleClaudeRegistrations,
  pruneStaleClaudeRegistrationsOnDisk,
  userHeldClaudePlugins,
  writtenHarnessTapMarketplaces,
} from "./claude-plugin-registration-prune.js";
import { claudeChangedMarketplaces } from "./claude-marketplace-registration.js";
import { isPreexistingPath } from "../models/preexisting-path.js";
import { forgetHostPluginView, recordedHostPluginViewPaths } from "./package-cache/host-plugin-views.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLEARED_GLOBAL_PROFILE_NAME,
  CLEARED_GLOBAL_PROFILE_PLUGIN_ID,
  isEmptyBuiltinProfile,
  isProfilePlugin,
} from "../constants/profile.js";
import { getHarnesstapDir } from "../db/connection.js";
import { getEnvironment } from "../models/environment.js";
import {
  createGlobalApplySnapshot,
  getLatestGlobalApplySnapshotForProfile,
  listGlobalApplySnapshotInstalls,
  listGlobalApplySnapshotHeads,
  recordGlobalApplySnapshotInstall,
} from "../models/global-apply-snapshot.js";
import {
  getPluginById,
  getPluginByPublishedIdentity,
  mergePluginsById,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { ui } from "../ui/index.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import { clearLiveReadCaches } from "./live-read-cache.js";
import {
  applyToGlobal,
  type ConflictPolicy,
  type ConflictResolution,
  generateFiles,
  type MaterializationConflict,
  materializeFiles,
  removeGlobalMaterializedFiles,
} from "./applier.js";
import { gateDeployFiles } from "./deploy-gate.js";
import { traceCount, traceSpan } from "./status-trace.js";
import { resolveEnvironmentCascadeForApply } from "./environment-cascade.js";
import { substituteResourcesForApply } from "./environment-var-substitution.js";
import {
  collectOtherProfilesSnapshotTrackedFiles,
  keptFilesInLeftHostPluginFolders,
  planStaleGlobalProfileFiles,
  planStaleMergeableHostConfigFiles,
} from "./global-profile-cleanup.js";
import { resolveRegisteredGlobalApplyHarnesses } from "./harness-targets.js";
import { rewriteStaleMergeableHostConfigs } from "./host-config-strip.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import type { PluginPinView, PluginRefView } from "./plugin-composition.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import { planHostPluginFoldersForPins } from "./host-plugin-apply-plan.js";
import { collectPluginPinsForPrepare, preparePluginPinsForApply } from "./plugin-pin-apply.js";
import { parsePluginSelector, resolveRemotePluginSelector } from "./plugin-selector.js";
import { resolveComposition } from "./resolve/index.js";
import { listComposedDependencies } from "./plugin-extends.js";
import type { ResolutionResult } from "./resolve/types.js";
import {
  formatRemovalBackupNotice,
  groupPlannedRemovals,
  isHarnessTapOwnedPath,
  mergeSafeRemovalSkips,
  skippedWriteKeepsForOwnership,
  type PlannedRemovals,
  type SafeFileRemovalResult,
  type SafeRemovalSkip,
} from "./safe-file-removal.js";

/** HT library deps that belong in the profile stack (not host marketplace/git/path pins). */
function isProfileStackDependency(ref: string): boolean {
  const parsed = parseDependencyRef(ref);
  if (parsed.source_kind === "catalog") {
    return true;
  }
  if (parsed.source_kind !== "local") {
    return false;
  }
  return !(
    parsed.origin_ref.startsWith("./")
    || parsed.origin_ref.startsWith("../")
  );
}

// Both read the composed set, so an extends child stacks its parent's items.
function listProfileStackRefs(pluginId: string): PluginRefView[] {
  return listComposedDependencies(pluginId)
    .map((dependency) => ({
      dependency_name: dependency.ref,
      version_constraint: dependency.version_constraint,
      resource: dependency.resource,
    }))
    .filter((ref) => isProfileStackDependency(ref.dependency_name));
}

function listHostPluginPins(pluginId: string): PluginPinView[] {
  return listComposedDependencies(pluginId)
    .map((dependency) => ({
      ref: dependency.ref,
      version_constraint: dependency.version_constraint,
      embed_on_export: dependency.embed_on_export,
      resource: dependency.resource,
    }))
    .filter((pin) => {
    const kind = parseDependencyRef(pin.ref).source_kind;
    return kind === "marketplace" || kind === "git";
  });
}

export interface ApplyProfilePluginOptions {
  harness?: string;
  conflictPolicy: ConflictPolicy;
  conflictResolver?: (
    conflict: MaterializationConflict,
  ) => Promise<ConflictResolution> | ConflictResolution;
  dryRun?: boolean;
  pull?: boolean;
  account?: string;
  baseUrl?: string;
  /**
   * When false, allow applying a non-profile plugin to machine home without
   * requiring the `profile` tag. Active-profile recording is owned by callers.
   * Defaults to true (require profile tag).
   */
  recordActiveProfile?: boolean;
  forceUnicode?: boolean;
  forceRemove?: boolean;
  yes?: boolean;
  interactive?: boolean;
  /** When false, status/drift keeps per-harness skill paths. Default true. */
  pinSkillEmits?: boolean;
  /**
   * Dry-run serialize: false compares the library snapshot to live files
   * (status/drift). Default true keeps extra live skill body for apply/preview.
   */
  mergeLiveSkillMarkdown?: boolean;
  /**
   * Dry run only: also plan the writes, keeps and blocked files in the host
   * plugin cache folders of pinned marketplace plugins, as the real apply
   * does while it installs them. Off for status, drift and previews.
   */
  planPluginFolders?: boolean;
}

export interface ApplyProfilePluginResult {
  profile_name: string;
  profile_plugin_id: string;
  configured_plugin_ids: string[];
  harnesses: string[];
  dry_run: boolean;
  snapshot_id?: string;
  cancelled: boolean;
  files: string[];
  written_files: string[];
  skipped_files: string[];
  conflicts: string[];
  default_environment_name?: string;
  pulled_plugins?: Array<{ plugin_name: string; source: string }>;
  expected_files?: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>;
  removed_files?: string[];
  skipped_removals?: SafeRemovalSkip[];
  removal_backup?: string;
  removals?: PlannedRemovals;
  resolution?: ResolutionResult;
}

function collectProfileSnapshotTrackedFiles(profileName: string): string[] {
  const snapshot = getLatestGlobalApplySnapshotForProfile(profileName);
  if (!snapshot) {
    return [];
  }
  return [
    ...new Set(
      listGlobalApplySnapshotInstalls(snapshot.id).flatMap(
        (install) => install.files,
      ),
    ),
  ];
}

function collectPreviousGlobalApplyTrackedFiles(): string[] {
  const [previousSnapshot] = listGlobalApplySnapshotHeads();
  if (!previousSnapshot) {
    return [];
  }
  return collectProfileSnapshotTrackedFiles(previousSnapshot.profile_name);
}

async function collectOutgoingProfileFilesForCleanup(
  outgoingProfileName: string,
  incomingProfileName: string,
  options: Pick<ApplyProfilePluginOptions, "harness" | "pull">,
): Promise<string[]> {
  if (outgoingProfileName === incomingProfileName) {
    return collectProfileSnapshotTrackedFiles(outgoingProfileName);
  }

  const fromSnapshot = collectProfileSnapshotTrackedFiles(outgoingProfileName);
  const outgoingApply = await applyProfilePlugin(outgoingProfileName, {
    dryRun: true,
    harness: options.harness,
    conflictPolicy: "replace",
    pull: options.pull ?? false,
  });

  return [...new Set([...fromSnapshot, ...outgoingApply.files])];
}

async function resolvePreviousTrackedFilesForApply(
  incomingProfileName: string,
  options: Pick<ApplyProfilePluginOptions, "harness" | "pull">,
): Promise<string[]> {
  const outgoingProfile = getActiveProfileName();
  const tracked = new Set<string>();

  if (outgoingProfile && outgoingProfile !== incomingProfileName) {
    for (const filePath of await collectOutgoingProfileFilesForCleanup(
      outgoingProfile,
      incomingProfileName,
      options,
    )) {
      tracked.add(filePath);
    }
  } else if (outgoingProfile) {
    for (const filePath of collectProfileSnapshotTrackedFiles(outgoingProfile)) {
      tracked.add(filePath);
    }
  }

  for (const filePath of collectOtherProfilesSnapshotTrackedFiles(incomingProfileName)) {
    tracked.add(filePath);
  }

  if (tracked.size > 0) {
    return [...tracked];
  }

  return collectPreviousGlobalApplyTrackedFiles();
}

function removeStaleGlobalProfileFiles(
  homeRoot: string,
  desiredFiles: readonly string[],
  previousTrackedFiles: readonly string[],
  harnesses: string[],
  options: {
    dryRun?: boolean;
    forceRemove?: boolean;
    applyId?: string;
    snapshotId?: string;
  } = {},
): SafeFileRemovalResult {
  // Read before the removal below deletes the plugin folder records and
  // HarnessTap's marketplace folders.
  const staleClaudeRecords = planStaleClaudeRegistrations(homeRoot, desiredFiles);
  const changedMarketplaces = claudeChangedMarketplaces(homeRoot);
  // Plugins the user installed with Claude Code keep their folder, their
  // marketplace and their enabledPlugins entry, whatever marketplace they
  // came from.
  const userHeld = userHeldClaudePlugins(homeRoot);
  const heldStale = new Set<string>();
  const plannedStale = planStaleGlobalProfileFiles(
    homeRoot,
    desiredFiles,
    previousTrackedFiles,
    harnesses,
  );
  const leavingMarketplaces = writtenHarnessTapMarketplaces(plannedStale);
  const staleFiles = plannedStale.filter((path) => {
    const held = heldFolderOf(userHeld.folders, path);
    if (held) heldStale.add(held);
    return !held;
  }).filter((path) =>
    // Claude's plugin registries that HarnessTap merged into, that changed
    // since, or that hold anyone else's entries lose only HarnessTap's keys
    // (below), never the whole file.
    !isClaudePluginRegistryPath(path)
    || (!isPreexistingPath(homeRoot, path)
      && isHarnessTapOwnedPath(homeRoot, path)
      && holdsOnlyLeavingHarnessTapRegistrations(homeRoot, path, staleClaudeRecords)));
  const mergeFiles = planStaleMergeableHostConfigFiles(
    homeRoot,
    desiredFiles,
    previousTrackedFiles,
    harnesses,
  );
  const removed = removeGlobalMaterializedFiles(homeRoot, staleFiles, {
    dryRun: options.dryRun,
    forceRemove: options.forceRemove,
    applyId: options.applyId,
    snapshotId: options.snapshotId,
  });
  const rewritten = rewriteStaleMergeableHostConfigs(homeRoot, mergeFiles, {
    applyId: removed.applyId,
    snapshotId: options.snapshotId,
    dryRun: options.dryRun,
    keepPluginRefs: userHeld.refs,
  });
  // Said once per folder HarnessTap set up: the folder record is dropped
  // here, after which the folder is the user's like any other.
  const heldWarnings = [...heldStale].sort().flatMap((folder) => {
    const held = userHeld.folders.get(folder);
    if (!held?.created) return [];
    if (!options.dryRun && folder.startsWith(".claude/plugins/cache/")) {
      forgetHostPluginView(join(homeRoot, folder));
    }
    return [`Kept ${folder}: you installed ${held.ref} with Claude Code and it uses this folder. `
      + `Run \`claude plugin uninstall ${held.ref}\` if you no longer need it.`];
  });
  const prunedClaude = pruneStaleClaudeRegistrationsOnDisk(
    homeRoot,
    staleClaudeRecords,
    desiredFiles,
    {
      applyId: removed.applyId,
      snapshotId: options.snapshotId,
      dryRun: options.dryRun,
      changedMarketplaces,
      leavingMarketplaces,
    },
  );
  // A plugin folder left behind keeps the user's own files, even with
  // --force-remove (HarnessTap never wrote them): say so.
  const keptInLeftFolders = keptFilesInLeftHostPluginFolders(
    homeRoot,
    desiredFiles,
    staleFiles,
    removed.removed,
    removed.skipped,
  );
  return {
    ...removed,
    removed: [...removed.removed, ...rewritten.removed],
    skipped: [...removed.skipped, ...keptInLeftFolders],
    warnings: [
      ...removed.warnings,
      ...keptInLeftFolders.map((skip) => skip.message),
      ...[...new Set([...rewritten.rewritten, ...prunedClaude.rewritten])]
        .map((path) => `Updated ${path} (removed HarnessTap-managed keys).`),
      ...prunedClaude.warnings,
      ...heldWarnings,
    ],
  };
}

function warnSkippedRemovals(
  result: SafeFileRemovalResult,
  extraSkips: readonly SafeRemovalSkip[] = [],
): void {
  const skipMessages = new Set(
    mergeSafeRemovalSkips(result.skipped, extraSkips).map((skip) => skip.message),
  );
  for (const warning of result.warnings) {
    if (skipMessages.has(warning)) {
      continue;
    }
    console.warn(ui.theme.warn(warning));
  }
  const notice = formatRemovalBackupNotice(result, resolveHomeRoot());
  if (notice) {
    ui.info(notice);
  }
}

function removalFields(
  result: SafeFileRemovalResult,
  extraSkips: readonly SafeRemovalSkip[] = [],
): Pick<
  ApplyProfilePluginResult,
  "removed_files" | "skipped_removals" | "removal_backup" | "removals"
> {
  const skipped = mergeSafeRemovalSkips(result.skipped, extraSkips);
  return {
    ...(result.removed.length > 0 ? { removed_files: result.removed } : {}),
    ...(skipped.length > 0 ? { skipped_removals: skipped } : {}),
    ...(result.removed.length > 0 ? { removal_backup: result.backupDir } : {}),
    removals: groupPlannedRemovals({
      remove: result.removed,
      skip: skipped,
    }),
  };
}

function normalizeVersionConstraint(versionConstraint: string): string | undefined {
  const trimmed = versionConstraint.trim();
  if (!trimmed || trimmed === "*" || trimmed === "latest") {
    return undefined;
  }
  return trimmed;
}

function resolveDependencyPlugin(ref: {
  dependency_name: string;
  version_constraint: string;
}): Plugin | undefined {
  try {
    const parsed = parsePluginSelector(ref.dependency_name);
    if (parsed.scope === "published") {
      const version = normalizeVersionConstraint(ref.version_constraint) ?? parsed.version;
      if (version) {
        const byPublishedIdentity = getPluginByPublishedIdentity({
          name: parsed.name,
          version,
          org: parsed.org,
          catalog: parsed.catalog,
        });
        if (byPublishedIdentity) {
          return byPublishedIdentity;
        }
      }
    }
  } catch {
    // Fall back to local selector resolution below.
  }

  const versionConstraint = normalizeVersionConstraint(ref.version_constraint);
  if (versionConstraint) {
    const withVersion = resolvePluginSelector(
      `${ref.dependency_name}@${versionConstraint}`,
    );
    if (withVersion) {
      return withVersion;
    }
  }
  return resolvePluginSelector(ref.dependency_name);
}

async function ensureProfileDependenciesAvailable(
  profilePlugin: Plugin,
  options: ApplyProfilePluginOptions,
): Promise<Array<{ plugin_name: string; source: string }>> {
  const pulledPlugins: Array<{ plugin_name: string; source: string }> = [];
  const queue: Plugin[] = [profilePlugin];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const plugin = queue.shift();
    if (!plugin || visited.has(plugin.id)) {
      continue;
    }
    visited.add(plugin.id);

    for (const ref of listProfileStackRefs(plugin.id)) {
      const localDependency = resolveDependencyPlugin(ref);
      if (localDependency) {
        queue.push(localDependency);
        continue;
      }

      let parsed: ReturnType<typeof parsePluginSelector>;
      try {
        parsed = parsePluginSelector(ref.dependency_name);
      } catch {
        throw new Error(
          `Missing local plugin dependency "${ref.dependency_name}" referenced by profile "${plugin.name}"`,
        );
      }

      if (parsed.scope !== "published") {
        throw new Error(
          `Missing local plugin dependency "${ref.dependency_name}" referenced by profile "${plugin.name}"`,
        );
      }

      if (options.pull === false) {
        throw new Error(
          `Missing published dependency "${ref.dependency_name}" for profile "${plugin.name}". Re-run without --no-pull.`,
        );
      }

      const remoteSelector = resolveRemotePluginSelector(ref.dependency_name, {
        version: normalizeVersionConstraint(ref.version_constraint),
      });
      const installed = await installPluginFromCatalog(remoteSelector, {
        account: options.account,
        baseUrl: options.baseUrl,
      });
      pulledPlugins.push({
        plugin_name: installed.pluginName,
        source: installed.sourceLabel,
      });
      const resolvedInstalled = getPluginById(installed.pluginId);
      if (resolvedInstalled) {
        queue.push(resolvedInstalled);
      }
    }
  }

  return pulledPlugins;
}

export function collectProfilePluginIds(profilePlugin: Plugin): string[] {
  const orderedIds: string[] = [];
  const queue: Plugin[] = [profilePlugin];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const plugin = queue.shift();
    if (!plugin || visited.has(plugin.id)) {
      continue;
    }
    visited.add(plugin.id);
    orderedIds.push(plugin.id);

    for (const ref of listProfileStackRefs(plugin.id)) {
      const resolved = resolveDependencyPlugin(ref);
      if (!resolved) {
        throw new Error(
          `Missing local plugin dependency "${ref.dependency_name}" referenced by profile "${plugin.name}"`,
        );
      }
      queue.push(resolved);
    }
  }

  return orderedIds;
}

function listResolvedPluginPins(
  resolution: ResolutionResult,
): Array<{ ref: string; version_constraint: string }> {
  const pins = new Map<string, { ref: string; version_constraint: string }>();
  // Deeper plugins first so nearer ones overwrite, matching Pass 2.
  const ordered = [...resolution.selected].sort(
    (a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex,
  );
  for (const plugin of ordered) {
    for (const pin of listHostPluginPins(plugin.pluginId)) {
      pins.set(pin.ref, {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
      });
    }
  }
  return [...pins.values()];
}

function resolveGlobalApplyHarnessTargets(harnessOption?: string): string[] {
  return resolveRegisteredGlobalApplyHarnesses(harnessOption);
}

function writeHomeActiveEnvironment(name: string): string {
  const home = getHarnesstapDir();
  mkdirSync(home, { recursive: true });
  const filePath = join(home, "active-environment.json");
  writeFileSync(filePath, `${JSON.stringify({ name }, null, 2)}\n`, "utf-8");
  return filePath;
}

export class ProfileEmptyProfileRemovedError extends Error {
  constructor() {
    super(
      'Profile "empty" is no longer available. Use "profile stash" to save the active profile and clear global harness files.',
    );
    this.name = "ProfileEmptyProfileRemovedError";
  }
}

export async function clearGlobalProfileApply(
  options: ApplyProfilePluginOptions,
): Promise<ApplyProfilePluginResult> {
  const harnesses = resolveGlobalApplyHarnessTargets(options.harness);
  const homeRoot = resolveHomeRoot();
  const previousTrackedFiles = await resolvePreviousTrackedFilesForApply(
    CLEARED_GLOBAL_PROFILE_NAME,
    options,
  );
  if (options.dryRun) {
    const planned = removeStaleGlobalProfileFiles(
      homeRoot,
      [],
      previousTrackedFiles,
      harnesses,
      { dryRun: true, forceRemove: options.forceRemove },
    );
    return {
      profile_name: CLEARED_GLOBAL_PROFILE_NAME,
      profile_plugin_id: CLEARED_GLOBAL_PROFILE_PLUGIN_ID,
      configured_plugin_ids: [],
      harnesses,
      dry_run: true,
      cancelled: false,
      files: [],
      written_files: [],
      skipped_files: [],
      conflicts: [],
      expected_files: [],
      ...removalFields(planned),
    };
  }

  const snapshot = createGlobalApplySnapshot({
    profile_name: CLEARED_GLOBAL_PROFILE_NAME,
    plugin_ids: [],
  });
  const removed = removeStaleGlobalProfileFiles(
    homeRoot,
    [],
    previousTrackedFiles,
    harnesses,
    {
      forceRemove: options.forceRemove,
      applyId: snapshot.id,
      snapshotId: snapshot.id,
    },
  );
  warnSkippedRemovals(removed);

  return {
    profile_name: CLEARED_GLOBAL_PROFILE_NAME,
    profile_plugin_id: CLEARED_GLOBAL_PROFILE_PLUGIN_ID,
    configured_plugin_ids: [],
    harnesses,
    dry_run: false,
    snapshot_id: snapshot.id,
    cancelled: false,
    files: [],
    written_files: [],
    skipped_files: [],
    conflicts: [],
    ...removalFields(removed),
  };
}

export async function applyProfilePlugin(
  selector: string,
  options: ApplyProfilePluginOptions,
): Promise<ApplyProfilePluginResult> {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileEmptyProfileRemovedError();
  }

  const profilePlugin = resolvePluginSelector(selector);
  if (!profilePlugin) {
    throw new Error(`Plugin not found: ${selector}`);
  }
  const requireProfileTag = options.recordActiveProfile !== false;
  if (requireProfileTag && !isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
  }

  const pulledPlugins = await traceSpan("dry-run.dependencies", () =>
    ensureProfileDependenciesAvailable(profilePlugin, options),
  );
  const homeRoot = resolveHomeRoot();
  const rootPluginPins = collectPluginPinsForPrepare([profilePlugin.id]);
  const skipPluginSync = rootPluginPins.length === 0;

  // Marketplace/git pins on the profile root must be materialized before the
  // first composition resolve can walk them as upstream plugins. Dry-run skips
  // host install CLI calls but still syncs from trees that are already installed.
  traceCount("dry-run.plugin-pins", "pins", rootPluginPins.length);
  await traceSpan("dry-run.plugin-pins", () => preparePluginPinsForApply({
    pins: rootPluginPins,
    baseResources: [],
    projectRoot: homeRoot,
    homeRoot,
    claudeConfig: mergePluginsById([profilePlugin.id]).claude,
    scope: "user",
    skipSync: skipPluginSync,
    ignoreMissingInstall: Boolean(options.dryRun),
    yes: options.yes,
    interactive: options.interactive,
    profileName: profilePlugin.name,
  }));

  let resolution = traceSpan("dry-run.resolve-composition", () =>
    resolveComposition({ rootSelectors: [profilePlugin.name] }),
  );
  traceCount("dry-run.resolve-composition", "resources", resolution.resources.length);
  let merged = {
    plugins: resolution.selected
      .map((plugin) => getPluginById(plugin.pluginId))
      .filter((plugin): plugin is NonNullable<typeof plugin> => plugin != null),
    resources: resolution.resources,
    claude: mergePluginsById(
      [...resolution.selected]
        .sort((a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex)
        .map((plugin) => plugin.pluginId),
    ).claude,
    pluginPins: listResolvedPluginPins(resolution),
  };
  for (const warning of resolution.warnings) {
    console.warn(ui.theme.warn(warning));
  }
  const configuredPluginIds = merged.plugins.map((plugin) => plugin.id);
  const resolvedSet = resolution.selected
    .filter((plugin) => plugin.depth > 0)
    .map((plugin) => ({ name: plugin.name, version: plugin.version }));
  const harnesses = resolveGlobalApplyHarnessTargets(options.harness);
  const resolvedEnvironment = resolveEnvironmentCascadeForApply({
    configuredPluginIds,
  });

  let defaultEnvironmentName: string | undefined;
  if (profilePlugin.default_environment_id) {
    const environment = getEnvironment(profilePlugin.default_environment_id);
    if (!environment) {
      throw new Error(
        `Default environment ${profilePlugin.default_environment_id} not found for profile ${profilePlugin.name}`,
      );
    }
    defaultEnvironmentName = environment.name;
  }

  const rootPinRefs = new Set(rootPluginPins.map((pin) => pin.ref));
  const additionalPins = collectPluginPinsForPrepare(configuredPluginIds).filter(
    (pin) => !rootPinRefs.has(pin.ref),
  );
  if (!options.dryRun && additionalPins.length > 0) {
    const additionalPrepare = await preparePluginPinsForApply({
      pins: additionalPins,
      baseResources: merged.resources,
      projectRoot: homeRoot,
      claudeConfig: merged.claude,
      scope: "user",
      skipSync: false,
      yes: options.yes,
      interactive: options.interactive,
      profileName: profilePlugin.name,
    });
    if (
      additionalPrepare.installs.some(
        (install) => install.status !== "already_installed",
      )
    ) {
      resolution = resolveComposition({ rootSelectors: [profilePlugin.name] });
      merged = {
        plugins: resolution.selected
          .map((plugin) => getPluginById(plugin.pluginId))
          .filter((plugin): plugin is NonNullable<typeof plugin> => plugin != null),
        resources: resolution.resources,
        claude: mergePluginsById(
          [...resolution.selected]
            .sort((a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex)
            .map((plugin) => plugin.pluginId),
        ).claude,
        pluginPins: listResolvedPluginPins(resolution),
      };
    }
  }

  const resolvedResources = merged.resources;
  const applyResources = substituteResourcesForApply(
    resolvedResources,
    resolvedEnvironment.vars,
  ).resources;

  if (options.dryRun) {
    const previousTrackedFiles = await traceSpan("dry-run.previous-tracked", () =>
      resolvePreviousTrackedFilesForApply(profilePlugin.name, options),
    );
    const generated = await traceSpan("dry-run.generate-files", () =>
      generateFiles(applyResources, harnesses, homeRoot, {
        target: "global",
        claudeConfig: merged.claude,
        resolvedEnvironment,
        replacesHarnessTapRegistrations: true,
        pinSkillEmits: options.pinSkillEmits,
        mergeLiveSkillMarkdown: options.mergeLiveSkillMarkdown,
      }),
    );
    const files = generated.flatMap((result) => result.files);
    traceCount("dry-run.generate-files", "files", files.length);
    const materialized = await traceSpan("dry-run.materialize-plan", () =>
      materializeFiles(files, homeRoot, {
        conflictPolicy: options.conflictPolicy,
        conflictResolver: options.conflictResolver,
        dryRun: true,
      }),
    );
    const writing = new Set(materialized.writtenFiles);
    traceSpan("dry-run.unicode-gate", () =>
      gateDeployFiles(
        files.filter((file) => writing.has(file.path)),
        { forceUnicode: options.forceUnicode, rootPath: homeRoot },
      ),
    );
    const desiredFiles = files.map((file) => file.path);
    const plannedRemoval = traceSpan("dry-run.stale-removal", () =>
      removeStaleGlobalProfileFiles(
        homeRoot,
        desiredFiles,
        previousTrackedFiles,
        harnesses,
        { dryRun: true, forceRemove: options.forceRemove },
      ),
    );
    const writeKeeps = traceSpan("dry-run.ownership-keeps", () =>
      skippedWriteKeepsForOwnership(homeRoot, materialized.skippedFiles),
    );
    const folders = options.planPluginFolders
      ? traceSpan("dry-run.plugin-folders", () =>
          planHostPluginFoldersForPins({ homeRoot, pins: merged.pluginPins }),
        )
      : undefined;
    return {
      profile_name: profilePlugin.name,
      profile_plugin_id: profilePlugin.id,
      configured_plugin_ids: configuredPluginIds,
      harnesses,
      dry_run: true,
      cancelled: materialized.cancelled,
      files: files.map((file) => file.path),
      written_files: folders
        ? [...new Set([...materialized.writtenFiles, ...folders.write])]
        : materialized.writtenFiles,
      skipped_files: materialized.skippedFiles,
      conflicts: materialized.conflicts.map((conflict) => conflict.path),
      expected_files: files.map((file) => ({
        path: file.path,
        content: file.content,
        ...(file.encoding === "base64" ? { encoding: "base64" as const } : {}),
      })),
      ...(defaultEnvironmentName ? { default_environment_name: defaultEnvironmentName } : {}),
      ...(pulledPlugins.length > 0 ? { pulled_plugins: pulledPlugins } : {}),
      resolution,
      ...removalFields(
        folders
          ? { ...plannedRemoval, removed: [...plannedRemoval.removed, ...folders.remove] }
          : plannedRemoval,
        folders ? [...writeKeeps, ...folders.kept] : writeKeeps,
      ),
    };
  }

  try {
  const previousTrackedFiles = await resolvePreviousTrackedFilesForApply(
    profilePlugin.name,
    options,
  );
  const applied = await applyToGlobal(applyResources, harnesses, homeRoot, {
    conflictPolicy: options.conflictPolicy,
    conflictResolver: options.conflictResolver,
    resolvedEnvironment,
    claudeConfig: merged.claude,
    replacesHarnessTapRegistrations: true,
    forceUnicode: options.forceUnicode,
    previousTrackedFiles,
  });
  let snapshotId: string | undefined;
  let removal: SafeFileRemovalResult | undefined;
  const writeKeeps = applied.cancelled
    ? []
    : skippedWriteKeepsForOwnership(homeRoot, applied.skippedFiles);
  if (!applied.cancelled) {
    const desiredFiles = applied.results.flatMap((result) =>
      result.files.map((file) => file.path),
    );
    const plannedRemoval = removeStaleGlobalProfileFiles(
      homeRoot,
      desiredFiles,
      previousTrackedFiles,
      harnesses,
      { dryRun: true, forceRemove: options.forceRemove },
    );
    const hasChanges =
      applied.writtenFiles.length > 0 || plannedRemoval.removed.length > 0;
    const alreadyApplied = Boolean(
      getLatestGlobalApplySnapshotForProfile(profilePlugin.name),
    );
    if (hasChanges || !alreadyApplied) {
      const snapshot = createGlobalApplySnapshot({
        profile_name: profilePlugin.name,
        plugin_ids: configuredPluginIds,
        resolved_set: resolvedSet,
        state: applied.preApplyState,
      });
      snapshotId = snapshot.id;
      removal = removeStaleGlobalProfileFiles(
        homeRoot,
        desiredFiles,
        previousTrackedFiles,
        harnesses,
        {
          forceRemove: options.forceRemove,
          applyId: snapshot.id,
          snapshotId: snapshot.id,
        },
      );
      warnSkippedRemovals(removal, writeKeeps);
      for (const result of applied.results) {
        const emitted = result.files.map((file) => file.path);
        // Files the install wrote into host plugin folders that the apply
        // never emits (links such as AGENTS.md) belong to the manifest too.
        const installFiles = [
          ...new Set([...emitted, ...recordedHostPluginViewPaths(homeRoot, emitted)]),
        ];
        if (installFiles.length === 0) continue;
        recordGlobalApplySnapshotInstall({
          snapshot_id: snapshot.id,
          platform_id: result.platformId,
          files: installFiles,
        });
      }
    } else {
      removal = plannedRemoval;
    }
  }
  if (!applied.cancelled && defaultEnvironmentName) {
    writeHomeActiveEnvironment(defaultEnvironmentName);
  }

  return {
    profile_name: profilePlugin.name,
    profile_plugin_id: profilePlugin.id,
    configured_plugin_ids: configuredPluginIds,
    harnesses,
    dry_run: false,
    ...(snapshotId ? { snapshot_id: snapshotId } : {}),
    cancelled: applied.cancelled,
    files: applied.results.flatMap((result) => result.files.map((file) => file.path)),
    written_files: applied.writtenFiles,
    skipped_files: applied.skippedFiles,
    conflicts: applied.conflicts.map((conflict) => conflict.path),
    ...(defaultEnvironmentName ? { default_environment_name: defaultEnvironmentName } : {}),
    ...(pulledPlugins.length > 0 ? { pulled_plugins: pulledPlugins } : {}),
    resolution,
    ...(removal ? removalFields(removal, writeKeeps) : {}),
  };
  } finally {
    clearLiveReadCaches();
  }
}
