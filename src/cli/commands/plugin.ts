import { Option, type Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CliUsageError,
  conflictingOptions,
  missingRequiredArg,
} from "../../services/cli-errors.js";
import { formatCount, formatPluginLabel } from "../formatting.js";
import { parseCommaSeparatedList } from "../handlers/parse-flags.js";
import { handlePluginForkCommand } from "../handlers/plugin-fork.js";
import {
  handlePluginCheckCommand,
  handlePluginUpdateCommand,
} from "../handlers/plugin-origin-update.js";
import { handlePluginRollbackCommand } from "../handlers/plugin-rollback.js";
import { handlePluginVersionsCommand } from "../handlers/plugin-versions.js";
import { handlePluginInstallCommand } from "../handlers/plugin-install.js";
import {
  handlePluginPublishCommand,
  handlePluginPublishPlanCommand,
} from "../handlers/plugin-publish.js";
import { handlePluginShowCommand } from "../handlers/plugin-show-command.js";
import { handlePluginWhyCommand } from "../handlers/plugin-why.js";
import { resolvePluginMutationTarget } from "../handlers/resolve-plugin-mutation-target.js";
import {
  isPluginAttachmentOnlyType,
  resolveResourceListType,
} from "../handlers/resource-list.js";
import { configureCommandGroup } from "../help.js";
import { renderCliError } from "../runtime.js";
import { collectRepeatedOption, formatCommand } from "../shared.js";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { ui } from "../../ui/index.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "../../services/git.js";
import { TargetFlagError } from "../../services/apm-targets.js";
import { resolveProjectCompileTargets } from "../../services/compile-apm.js";
import {
  generateFiles,
  materializeFiles,
} from "../../services/applier.js";
import { exportPluginDefinition } from "../../services/plugin-editor.js";
import { importFromFile, inspectPluginExportFile } from "../../services/plugin-import.js";
import { openPathInSystemEditor } from "../../services/open-path.js";
import {
  createPlugin,
  getPlugin,
  listPlugins,
  deletePlugin,
  getPluginById,
  resolvePluginSelector,
  mergePluginsById,
  setPluginTags,
} from "../../models/plugin-model.js";
import { PROFILE_PLUGIN_TAG } from "../../constants/profile.js";
import {
  upsertProject,
  getProjectByOrigin,
  applyConfiguredPluginToProject,
} from "../../models/project.js";
import { createSnapshot } from "../../models/snapshot.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import type {
  ClaudePluginConfig,
  ClaudePluginEntry,
  Plugin,
  Resource,
  ResourceType,
  SnapshotState,
} from "../../types.js";
import { RESOURCE_TYPES } from "../../types.js";
import { listAttachedPluginPins } from "../../services/plugin-composition.js";
import {
  getProjectHarnessConfig,
} from "../../models/harness.js";
import {
  assertSupportedHarnessTargets,
  collectApplyPreferenceHarnesses,
} from "../../services/harness-targets.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import {
  handlePluginCatalogConnectPluginCommand,
  handlePluginCatalogConnectOrgCommand,
  handlePluginCatalogDisconnectPluginCommand,
  handlePluginCatalogDisconnectOrgCommand,
  handlePluginCatalogListCommand,
} from "../../services/plugin-catalog.js";
import {
  handlePluginCatalogBindingsCommand,
  handlePluginCatalogRegisterCommand,
  handlePluginCatalogRegisteredCommand,
  handlePluginCatalogUnregisterCommand,
} from "../../services/plugin-catalog-bindings.js";
import { resolveCatalogSearchProjectRoot } from "../../services/plugin-search-apply.js";
import {
  configurePluginListInteractiveDeps,
  handlePluginListCommand,
} from "../../services/plugin-list.js";
import {
  deleteCatalogPlugin,
  editCatalogPluginComposition,
} from "../../services/catalog-plugin-manage.js";
import {
  collectPluginPinsForPrepare,
  preparePluginPinsForApply,
  type SyncPluginPinsForApplyResult,
} from "../../services/plugin-pin-apply.js";
import { resolvePluginInstallScope, type InstallPluginPinResult } from "../../services/plugin-install.js";
import { resolveClaudeEnabledPluginRef } from "../../plugins/claude-plugin-ref.js";
import { diffPlugins } from "../../services/plugin-diff.js";
import {
  assertAuthored,
  PluginProvenanceError,
} from "../../services/plugin-origin.js";
import {
  cutPluginVersion,
  PluginVersionError,
} from "../../services/plugin-versioning.js";
import { listPluginDoctorChecks, runPluginDoctor } from "../../services/plugin-doctor.js";
import { resolveComposition } from "../../services/resolve/index.js";
import type { ResolutionResult } from "../../services/resolve/types.js";
import {
  SingletonConflictError,
  UnsatisfiableConstraintError,
} from "../../services/resolve/types.js";
import { offerConstraintRecovery } from "../../services/constraint-recovery.js";
import { offerConflictScaffold } from "../../services/resolve-conflict-scaffold.js";
import { explainPayload, renderExplain } from "../../services/resolve/explain.js";
import {
  lockedVersionsFrom,
  lockfileFromResolution,
  lockIsUsable,
  readLockfile,
  writeLockfile,
  type ApmGitLockFields,
} from "../../services/lockfile.js";
import {
  gateDeployFiles,
  LockIntegrityError,
  printUnicodeGateWarnings,
} from "../../services/deploy-gate.js";
import { CriticalUnicodeError } from "../../services/unicode-scan.js";
import { resolveApplySelectorsFromProjectManifest } from "../../services/apm-project-plugin.js";
import {
  assertPolicyAllowsApply,
  evaluateApplyPolicy,
  PolicyError,
} from "../../services/apm-policy.js";
import {
  applyExecutableTrustGate,
  formatApproveRemedy,
  overlappingDeployedHashes,
} from "../../services/executable-trust.js";
import { findProjectConfig } from "../../services/project-config.js";
import { resolveEnvironmentCascadeForApply } from "../../services/environment-cascade.js";
import { substituteResourcesForApply } from "../../services/environment-var-substitution.js";
import { setPluginEnvironmentCommand, unsetPluginEnvironmentCommand } from "../../services/environment-commands.js";
import { createPluginFromProject } from "../../services/plugin-from-project.js";
import { createPluginFromSource } from "../../services/plugin-from-source.js";
import {
  resolveApplyPluginSource,
  type ResolveApplyPluginSourceOptions,
} from "../../services/plugin-apply-source.js";
import { PluginAmbiguityError, PluginResolveError } from "../../services/plugin-bare-name-resolve.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
import {
  type ApplyCommandOpts,
} from "../../services/apply-command-options.js";
import {
  PLUGIN_ATTACHMENT_TYPES,
  PluginAttachmentHintError,
  validatePluginAttachmentType,
} from "../../services/plugin-composition.js";
import { createProgress, type ProgressHandle } from "../../ui/progress.js";
import {
  isPromptCancellationError,
  promptForChoice,
  promptForSearchableChoice,
  promptForValue,
  shouldUseBrowsePicker,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import {
  type CatalogPlugin,
  searchCatalogPlugins,
} from "../../services/marketplace-catalog.js";
import {
  addPluginFromMarketplace,
  type AddPluginFromMarketplaceResult,
} from "../../services/plugin-marketplace-add.js";
import { addDependency } from "../../services/plugin-dependency.js";
import type { OutputFormat } from "../../utils/output-format.js";
import {
  applyPluginEdit,
  applyPluginEditScripting,
  attachmentKey,
  buildPluginEditCandidates,
  buildPendingFromApplySpec,
  parsePluginEditApplyFile,
} from "../../services/plugin-edit.js";
import { runPluginEditWizard } from "../../services/wizards/plugin-edit.js";
import { runPluginDeleteWizard } from "../../services/wizards/plugin-delete.js";
import { runPluginFromProjectWizard } from "../../services/wizards/plugin-from-project.js";
import { runPluginApplyWizard } from "../../services/wizards/plugin-apply.js";
import { runPluginCreateFromSourceWizard } from "../../services/wizards/plugin-create-from-source.js";
import {
  resolveSkillPackageCheckout,
  type PluginSourceConflictPolicy,
} from "../../services/skill-package-resolve.js";
async function deleteLocalPluginByName(nameOrId: string): Promise<void> {
  const plugin = getPlugin(nameOrId);
  if (!plugin) {
    ui.danger(`Plugin not found: ${nameOrId}`);
    return;
  }
  if (!deletePlugin(plugin.id)) {
    ui.danger(`Failed to delete plugin ${formatPluginLabel(plugin)}`);
    return;
  }
  ui.success(`Deleted plugin ${ui.theme.accent(formatPluginLabel(plugin))}`);
}

async function resolveApplyRootSelectors(
  pluginNames: [string, ...string[]],
  projectRoot: string,
  options: ResolveApplyPluginSourceOptions & {
    onFetched?: (sourceLabel: string) => void;
  } = {},
): Promise<{ selectors: string[]; rootPluginIds: string[] }> {
  const resolvedSources = await Promise.all(
    pluginNames.map((selector) => resolveApplyPluginSource(selector, options)),
  );

  const selectors: string[] = [];
  const rootPluginIds: string[] = [];
  for (const source of resolvedSources) {
    if (source.kind === "plugin-export") {
      if (resolvedSources.length > 1) {
        throw new Error(
          "Plugin export paths and URLs cannot be mixed with plugin selectors.",
        );
      }
      const summary = inspectPluginExportFile(source.path);
      const primary = summary.plugins[summary.plugins.length - 1];
      const existing = primary
        ? resolvePluginSelector(
            primary.version ? `${primary.name}@${primary.version}` : primary.name,
          )
        : undefined;
      if (existing) {
        selectors.push(`${existing.name}@${existing.version}`);
        rootPluginIds.push(existing.id);
      } else {
        const imported = importFromFile(source.path, {
          embeddedTargetDir: projectRoot,
        });
        const last = imported.plugins[imported.plugins.length - 1];
        if (!last) throw new Error("Bundle contains no plugins.");
        selectors.push(`${last.plugin.name}@${last.plugin.version}`);
        rootPluginIds.push(last.plugin.id);
      }
      continue;
    }
    const plugin = getPluginById(source.pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${source.pluginId}`);
    selectors.push(`${plugin.name}@${plugin.version}`);
    rootPluginIds.push(plugin.id);
  }

  return { selectors, rootPluginIds };
}

async function resolveApplyPlugins(
  pluginNames: [string, ...string[]],
  projectRoot: string,
  options: ResolveApplyPluginSourceOptions & {
    onFetched?: (sourceLabel: string) => void;
    lockedVersions?: Map<string, string>;
    /** Skip a second catalog fetch when roots were already resolved for pin prepare. */
    resolvedRoots?: { selectors: string[]; rootPluginIds: string[] };
  } = {},
): Promise<{
  plugins: ReturnType<typeof getPlugin>[];
  resources: Resource[];
  claude?: ClaudePluginConfig;
  configuredPluginIds: string[];
  primaryConfiguredPluginId: string;
  resolution: ResolutionResult;
  rootPluginIds: string[];
}> {
  const { selectors, rootPluginIds } = options.resolvedRoots
    ?? await resolveApplyRootSelectors(
      pluginNames,
      projectRoot,
      options,
    );

  const resolution = resolveComposition({
    rootSelectors: selectors,
    ...(options.lockedVersions ? { lockedVersions: options.lockedVersions } : {}),
  });

  const plugins = resolution.selected
    .filter((plugin) => !(plugin.depth === 0 && resolution.root.ephemeral))
    .map((plugin) => getPluginById(plugin.pluginId))
    .filter((plugin): plugin is NonNullable<typeof plugin> => plugin != null);

  const claude = mergeClaudeConfigsForResolution(resolution);
  const configuredPluginIds = plugins.map((plugin) => plugin.id);

  return {
    plugins,
    resources: resolution.resources,
    ...(claude ? { claude } : {}),
    configuredPluginIds,
    // Nearest-to-root already gives the root precedence; the "primary" is the
    // root itself, or the last argv selector when the root is ephemeral.
    primaryConfiguredPluginId: resolution.root.ephemeral
      ? (configuredPluginIds[configuredPluginIds.length - 1] ?? "")
      : resolution.root.pluginId,
    resolution,
    rootPluginIds,
  };
}

/**
 * Claude marketplace/plugin config still merges the old way. Resolution
 * decides which plugins participate; within that set, deeper plugins are folded
 * in first so nearer ones win, matching Pass 2.
 */
function mergeClaudeConfigsForResolution(
  resolution: ResolutionResult,
): ClaudePluginConfig | undefined {
  const ordered = [...resolution.selected].sort(
    (a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex,
  );
  const pluginIds = ordered
    .map((plugin) => getPluginById(plugin.pluginId))
    .filter((plugin): plugin is NonNullable<typeof plugin> => plugin != null)
    .map((plugin) => plugin.id);
  return mergePluginsById(pluginIds).claude;
}

function formatPluginInstallLine(install: InstallPluginPinResult): string {
  const icon = install.status === "failed" ? ui.icons.warn : ui.icons.success;
  const statusLabel =
    install.status === "already_installed" ? "already installed" : install.status;
  return `  ${icon} ${install.ref} (${install.platformId}, ${install.scope}) ${ui.icons.bullet} ${statusLabel}`;
}

function printPluginInstallLine(install: InstallPluginPinResult): void {
  console.log(formatPluginInstallLine(install));
  if (install.status === "failed" && install.message) {
    console.log(ui.theme.muted(`    ${install.message}`));
  }
}

function printPluginApplyPostSyncSummary(
  sync: SyncPluginPinsForApplyResult,
  extraMaterializedCount: number,
): void {
  if (sync.syncedResourceCount === 0 && extraMaterializedCount === 0) {
    return;
  }

  if (sync.syncedResourceCount > 0) {
    console.log(
      ui.theme.muted(
        `  ${ui.icons.bullet} synced ${formatCount(sync.syncedResourceCount, "linked resource")}`,
      ),
    );
  }
  if (extraMaterializedCount > 0) {
    console.log(
      ui.theme.muted(
        `  ${ui.icons.bullet} ${formatCount(extraMaterializedCount, "plugin resource")} for harness materialization`,
      ),
    );
  }
}


export async function handleProjectApplyCommand(
  pluginNames: [string, ...string[]] | [],
  opts: ApplyCommandOpts,
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

  const outputFormat = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project);

  let resolvedPluginNames: string[] = pluginNames.length > 0 ? [...pluginNames] : [];
  let manifestGitLocks: ApmGitLockFields[] = [];
  if (resolvedPluginNames.length === 0) {
    let fromManifest: Awaited<ReturnType<typeof resolveApplySelectorsFromProjectManifest>>;
    try {
      fromManifest = await resolveApplySelectorsFromProjectManifest(projectRoot, {
        dryRun: opts.dryRun,
        account: opts.account,
        baseUrl: opts.baseUrl,
        update: opts.update,
      });
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
      return;
    }
    if (fromManifest && fromManifest.selectors.length > 0) {
      resolvedPluginNames = fromManifest.selectors;
      manifestGitLocks = fromManifest.gitLocks;
      const manifest = findProjectConfig(projectRoot);
      if (outputFormat === "human") {
        for (const warning of manifest?.warnings ?? []) {
          ui.warn(warning);
        }
      }
    } else if (
      shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      })
    ) {
      resolvedPluginNames = [await runPluginApplyWizard()];
    }
  }

  if (resolvedPluginNames.length === 0) {
    process.exitCode = 1;
    ui.danger(
      "Provide at least one plugin name, plugin export path, or URL, or declare dependencies in apm.yml.",
      {
        hints: [
          formatCommand("apply <plugin>"),
          formatCommand("config init"),
        ],
      },
    );
    return;
  }

  if (opts.strictPluginVersions && opts.ignorePluginVersions) {
    process.exitCode = 1;
    ui.danger(
      "Choose either --strict-plugin-versions or --ignore-plugin-versions, not both.",
    );
    return;
  }

  let applyBundle: Awaited<ReturnType<typeof resolveApplyPlugins>>;
  const pluginLabel = resolvedPluginNames.join(" + ");
  const resolveSpin = createProgress(`Resolving ${pluginLabel}…`);
  const existingLock = opts.update ? undefined : readLockfile(projectRoot);
  const lockedVersions =
    existingLock && lockIsUsable(existingLock, resolvedPluginNames[0] ?? "")
      ? lockedVersionsFrom(existingLock)
      : undefined;

  const resolveSourceOptions = {
    account: opts.account,
    baseUrl: opts.baseUrl,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: outputFormat,
    onFetched:
      outputFormat === "human"
        ? (sourceLabel: string) => {
            ui.info(`Fetched ${sourceLabel} from catalog`);
          }
        : undefined,
  };

  // Resolve argv selectors to concrete local plugins without walking the graph,
  // so marketplace/git pins on those roots can be prepared first.
  let rootPluginIds: string[];
  let rootSelectors: string[];
  try {
    ({ rootPluginIds, selectors: rootSelectors } = await resolveApplyRootSelectors(
      resolvedPluginNames as [string, ...string[]],
      projectRoot,
      resolveSourceOptions,
    ));
  } catch (err) {
    resolveSpin.stop();
    process.exitCode = 1;
    if (err instanceof PluginResolveError || err instanceof PluginAmbiguityError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  const rootPluginPins = collectPluginPinsForPrepare(rootPluginIds);
  // Always prepare marketplace/git pins when present so upstream stubs exist for
  // the dependency graph. Dry-run and --ignore-plugin-versions skip host installs
  // via ignoreMissingInstall (exact constraints are stamped locally).
  const skipPluginSync = rootPluginPins.length === 0;

  let pluginValidationIssues: Awaited<
    ReturnType<typeof preparePluginPinsForApply>
  >["validationIssues"] = [];
  let pluginPrepare: Awaited<ReturnType<typeof preparePluginPinsForApply>> = {
    installs: [],
    syncedResourceCount: 0,
    unresolvedPins: [],
    applyResources: [],
    extraMaterialized: 0,
    validationIssues: [],
  };
  const pluginProgressState: { current: ProgressHandle | null } = { current: null };

  if (!skipPluginSync) {
    resolveSpin.stop();
    console.log(ui.theme.muted("Plugins"));
    const rootClaude = mergePluginsById(rootPluginIds).claude;
    pluginPrepare = await preparePluginPinsForApply({
      pins: rootPluginPins,
      baseResources: [],
      projectRoot,
      claudeConfig: rootClaude,
      skipSync: false,
      syncAll: opts.syncPlugins,
      scope: resolvePluginInstallScope(projectRoot, Boolean(getGitOrigin(projectRoot))),
      ignoreMissingInstall: Boolean(opts.ignorePluginVersions || opts.dryRun),
      progress: {
        onInstallStart: (ref) => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = createProgress(`Installing ${ref}…`);
        },
        onInstallComplete: (install) => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = null;
          printPluginInstallLine(install);
        },
        onSyncStart: (ref) => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = createProgress(`Syncing ${ref}…`);
        },
        onSyncComplete: () => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = null;
        },
      },
    });
    pluginProgressState.current?.stop();
    pluginValidationIssues = pluginPrepare.validationIssues;
  }

  const compositionSpin = skipPluginSync
    ? resolveSpin
    : createProgress(`Resolving ${pluginLabel}…`);
  try {
    applyBundle = await resolveApplyPlugins(
      resolvedPluginNames as [string, ...string[]],
      projectRoot,
      {
        ...resolveSourceOptions,
        ...(lockedVersions ? { lockedVersions } : {}),
        resolvedRoots: { selectors: rootSelectors, rootPluginIds },
      },
    );
  } catch (err) {
    compositionSpin.stop();
    process.exitCode = 1;
    if (err instanceof UnsatisfiableConstraintError) {
      ui.danger(err.message, { hints: err.hints });
      const recovered = await offerConstraintRecovery({
        error: err,
        rootName: resolvedPluginNames[0] ?? "",
        projectRoot,
        ...(opts.interactive !== undefined ? { interactive: opts.interactive } : {}),
        ...(opts.noInteractive !== undefined
          ? { noInteractive: opts.noInteractive }
          : {}),
        format: outputFormat,
      });
      if (recovered) {
        process.exitCode = 0;
        ui.success("Constraint recovery applied. Re-applying…");
        await handleProjectApplyCommand(
          resolvedPluginNames as [string, ...string[]],
          opts,
        );
        return;
      }
      return;
    }
    if (err instanceof SingletonConflictError) {
      ui.danger(err.message, { hints: err.hints });
      const scaffolded = await offerConflictScaffold({
        error: err,
        attemptedSelectors: resolvedPluginNames as string[],
        ...(opts.interactive !== undefined ? { interactive: opts.interactive } : {}),
        ...(opts.noInteractive !== undefined
          ? { noInteractive: opts.noInteractive }
          : {}),
        format: outputFormat,
      });
      if (scaffolded) {
        process.exitCode = 0;
        ui.success(`Created composition plugin ${scaffolded}. Re-applying…`);
        await handleProjectApplyCommand([scaffolded], opts);
        return;
      }
      return;
    }
    if (err instanceof PluginResolveError || err instanceof PluginAmbiguityError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }
  compositionSpin.stop();

  for (const warning of applyBundle.resolution.warnings) {
    ui.warn(warning);
  }

  const primaryPlugin =
    applyBundle.plugins.find(
      (plugin) => plugin?.id === applyBundle.primaryConfiguredPluginId,
    ) ?? applyBundle.plugins[0];
  if (!primaryPlugin) {
    process.exitCode = 1;
    ui.danger("No plugin resolved for apply");
    return;
  }

  let platforms: string[];
  try {
    platforms = resolveApplyHarnessTargets(projectRoot, opts, pluginNames.length === 0);
  } catch (err) {
    process.exitCode = err instanceof TargetFlagError ? 2 : 1;
    ui.danger(err instanceof Error ? err.message : String(err), {
      hints: [
        formatCommand("targets"),
        "Declare targets: in apm.yml or pass --target / --harness",
      ],
    });
    return;
  }

  if (platforms.length === 0) {
    process.exitCode = 1;
    ui.warn(
      "No harness targets configured. Declare targets: in apm.yml or pass --target / --harness.",
    );
    return;
  }

  if (opts.explain) {
    if (outputFormat === "json") {
      printJson(explainPayload(applyBundle.resolution));
    } else {
      console.log(renderExplain(applyBundle.resolution));
      console.log("");
    }
  }

  let { resources, claude } = applyBundle;
  const resolvedEnvironment = resolveEnvironmentCascadeForApply({
    configuredPluginIds: applyBundle.configuredPluginIds,
  });
  const mergedPluginPins = (() => {
    const pins = new Map<string, { ref: string; version_constraint: string }>();
    for (const bundlePlugin of applyBundle.plugins) {
      if (!bundlePlugin) continue;
      for (const pin of listAttachedPluginPins(bundlePlugin.id)) {
        pins.set(pin.ref, {
          ref: pin.ref,
          version_constraint: pin.version_constraint,
        });
      }
    }
    return [...pins.values()];
  })();

  let applyResources = resources;

  // Prepare any marketplace/git pins discovered on non-root selected plugins
  // after the first successful resolve (root pins were prepared above).
  const rootPinRefs = new Set(rootPluginPins.map((pin) => pin.ref));
  const additionalPins = collectPluginPinsForPrepare(
    applyBundle.configuredPluginIds,
  ).filter((pin) => !rootPinRefs.has(pin.ref));
  const shouldPrepareAdditional = !opts.dryRun && additionalPins.length > 0;

  if (shouldPrepareAdditional) {
    if (skipPluginSync) {
      console.log(ui.theme.muted("Plugins"));
    }
    const additionalPrepare = await preparePluginPinsForApply({
      pins: additionalPins,
      baseResources: resources,
      projectRoot,
      claudeConfig: claude,
      skipSync: false,
      syncAll: opts.syncPlugins,
      scope: resolvePluginInstallScope(projectRoot, Boolean(getGitOrigin(projectRoot))),
      ignoreMissingInstall: opts.ignorePluginVersions,
      progress: {
        onInstallStart: (ref) => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = createProgress(`Installing ${ref}…`);
        },
        onInstallComplete: (install) => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = null;
          printPluginInstallLine(install);
        },
        onSyncStart: (ref) => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = createProgress(`Syncing ${ref}…`);
        },
        onSyncComplete: () => {
          pluginProgressState.current?.stop();
          pluginProgressState.current = null;
        },
      },
    });
    pluginProgressState.current?.stop();
    pluginPrepare = {
      ...additionalPrepare,
      installs: [...pluginPrepare.installs, ...additionalPrepare.installs],
      syncedResourceCount:
        pluginPrepare.syncedResourceCount + additionalPrepare.syncedResourceCount,
      unresolvedPins: [
        ...pluginPrepare.unresolvedPins,
        ...additionalPrepare.unresolvedPins,
      ],
    };
    pluginValidationIssues = additionalPrepare.validationIssues;

    if (
      additionalPrepare.installs.some(
        (install) => install.status !== "already_installed",
      )
    ) {
      try {
        applyBundle = await resolveApplyPlugins(
          resolvedPluginNames as [string, ...string[]],
          projectRoot,
          {
            account: opts.account,
            baseUrl: opts.baseUrl,
            interactive: opts.interactive,
            noInteractive: opts.noInteractive,
            format: outputFormat,
            ...(lockedVersions ? { lockedVersions } : {}),
            resolvedRoots: { selectors: rootSelectors, rootPluginIds },
          },
        );
        resources = applyBundle.resources;
        claude = applyBundle.claude;
        applyResources = resources;
      } catch (err) {
        process.exitCode = 1;
        if (err instanceof UnsatisfiableConstraintError) {
          ui.danger(err.message, { hints: err.hints });
          const recovered = await offerConstraintRecovery({
            error: err,
            rootName: resolvedPluginNames[0] ?? "",
            projectRoot,
            ...(opts.interactive !== undefined ? { interactive: opts.interactive } : {}),
            ...(opts.noInteractive !== undefined
              ? { noInteractive: opts.noInteractive }
              : {}),
            format: outputFormat,
          });
          if (recovered) {
            process.exitCode = 0;
            ui.success("Constraint recovery applied. Re-applying…");
            await handleProjectApplyCommand(
              resolvedPluginNames as [string, ...string[]],
              opts,
            );
            return;
          }
          return;
        }
        if (err instanceof SingletonConflictError) {
          ui.danger(err.message, { hints: err.hints });
          const scaffolded = await offerConflictScaffold({
            error: err,
            attemptedSelectors: resolvedPluginNames as string[],
            ...(opts.interactive !== undefined ? { interactive: opts.interactive } : {}),
            ...(opts.noInteractive !== undefined
              ? { noInteractive: opts.noInteractive }
              : {}),
            format: outputFormat,
          });
          if (scaffolded) {
            process.exitCode = 0;
            ui.success(`Created composition plugin ${scaffolded}. Re-applying…`);
            await handleProjectApplyCommand([scaffolded], opts);
            return;
          }
          return;
        }
        ui.danger(err instanceof Error ? err.message : String(err));
        return;
      }
    }
  } else if (mergedPluginPins.length > 0 && !opts.ignorePluginVersions && !opts.dryRun) {
    // Validate the full pin set even when sync already ran for root pins.
    pluginValidationIssues = (
      await preparePluginPinsForApply({
        pins: mergedPluginPins,
        baseResources: resources,
        projectRoot,
        claudeConfig: claude,
        skipSync: true,
      })
    ).validationIssues;
  }

  const substituted = substituteResourcesForApply(
    applyResources,
    resolvedEnvironment.vars,
  );
  applyResources = substituted.resources;
  if (opts.strict && substituted.missing.length > 0) {
    process.exitCode = 1;
    ui.danger("Strict mode failed: unresolved environment variables.", {
      hints: substituted.missing.map((key) => key),
    });
    return;
  }

  if (!skipPluginSync) {
    printPluginApplyPostSyncSummary(pluginPrepare, pluginPrepare.extraMaterialized);

    if (pluginPrepare.unresolvedPins.length > 0) {
      for (const ref of pluginPrepare.unresolvedPins) {
        console.warn(
          ui.theme.warn(
            `Plugin pin ${ref} is not installed locally. Run: harnesstap resource sync plugin_pin:${ref}`,
          ),
        );
      }
      if (opts.strictPluginVersions) {
        ui.danger("Plugin install failed — apply aborted");
        process.exitCode = 2;
        return;
      }
    }
  }

  const manifestForPolicy = findProjectConfig(projectRoot);
  const executableTrust = applyExecutableTrustGate({
    projectRoot,
    resolution: applyBundle.resolution,
    resources: applyResources,
    gitLocks: manifestGitLocks,
  });
  try {
    const policyEvaluation = evaluateApplyPolicy({
      projectRoot,
      resolution: applyBundle.resolution,
      resources: applyResources,
      apmDependencies: manifestForPolicy?.apmDependencies,
      mcpDependencies: manifestForPolicy?.mcpDependencies,
      gitLocks: manifestGitLocks,
      ...(manifestForPolicy?.policyPin ? { pin: manifestForPolicy.policyPin } : {}),
    });
    if (outputFormat === "human") {
      for (const warning of [...policyEvaluation.warnings, ...executableTrust.warnings]) {
        ui.warn(warning);
      }
      for (const violation of policyEvaluation.violations) {
        if (policyEvaluation.blocks) {
          ui.danger(violation.message);
        } else if (policyEvaluation.enforcement !== "off") {
          ui.warn(violation.message);
        }
      }
    }
    assertPolicyAllowsApply(policyEvaluation);
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof PolicyError) {
      ui.danger(err.message, {
        hints: ["Fix apm-policy.yml or the install plan, then re-apply"],
      });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  applyResources = executableTrust.resources;
  if (outputFormat === "human" && executableTrust.parked.length > 0) {
    const refs = executableTrust.parked.map((entry) => entry.ref);
    for (const entry of executableTrust.parked) {
      ui.warn(
        `Parked unapproved executables from ${entry.ref} (${entry.types.join(", ")})`,
      );
    }
    ui.hint(formatApproveRemedy(refs));
  }

  const homeRoot = resolveHomeRoot();
  const resolvedClaude =
    claude?.plugins && claude.plugins.length > 0
      ? {
          ...claude,
          plugins: claude.plugins.map((plugin: ClaudePluginEntry) => ({
            ...plugin,
            id: resolveClaudeEnabledPluginRef(plugin.id, homeRoot),
          })),
        }
      : claude;

  const generateSpin = createProgress("Generating harness files…");
  let generated: Awaited<ReturnType<typeof generateFiles>>;
  const gitOriginForApply = getGitOrigin(projectRoot);
  const projectForHarness = gitOriginForApply
    ? getProjectByOrigin(normalizeGitUrl(gitOriginForApply))
    : undefined;
  const projectHarnessConfig = projectForHarness
    ? getProjectHarnessConfig(projectForHarness.id)
    : undefined;
  try {
    generated = await generateFiles(
      applyResources,
      platforms,
      projectRoot,
      {
        claudeConfig: resolvedClaude,
        resolvedEnvironment,
        skillSourceRoot: projectRoot,
        ...(projectHarnessConfig?.cursor_skill_mode
          ? { skillCursorMode: projectHarnessConfig.cursor_skill_mode }
          : {}),
      },
    );
  } finally {
    generateSpin.stop();
  }

  const generatedFiles = generated.flatMap((result) =>
    result.files.map((file) => ({ path: file.path, content: file.content })),
  );
  const shouldVerifyHashes = Boolean(
    !opts.update &&
      existingLock &&
      lockIsUsable(existingLock, resolvedPluginNames[0] ?? "") &&
      existingLock.deployed_file_hashes &&
      Object.keys(existingLock.deployed_file_hashes).length > 0,
  );
  try {
    const expectedHashes = existingLock?.deployed_file_hashes;
    const gate = gateDeployFiles(generatedFiles, {
      forceUnicode: opts.force,
      verifyHashes: shouldVerifyHashes,
      expectedHashes:
        executableTrust.optedIn && expectedHashes
          ? overlappingDeployedHashes(expectedHashes, generatedFiles)
          : expectedHashes,
    });
    if (outputFormat === "human") {
      printUnicodeGateWarnings(gate.findings, opts.force);
    }
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof CriticalUnicodeError) {
      ui.danger(err.message, {
        hints: [formatCommand("apply --force")],
      });
      return;
    }
    if (err instanceof LockIntegrityError) {
      ui.danger(err.message, {
        hints: [formatCommand("apply --update")],
      });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  // Strict plugin validation must happen BEFORE any files are written.
  if (
    !opts.dryRun &&
    opts.strictPluginVersions &&
    !opts.ignorePluginVersions &&
    mergedPluginPins.length > 0
  ) {
    if (pluginValidationIssues.length > 0) {
      for (const issue of pluginValidationIssues) {
        console.warn(ui.theme.warn(issue.message));
      }
      ui.danger("Plugin pin violations — apply aborted");
      process.exitCode = 2;
      return;
    }
  }

  // Ephemeral multi-selector roots (`ht plugin apply a b`) use a synthetic
  // `__ht_ephemeral_root__…` name that is never reusable via lockIsUsable —
  // writing that lock would poison checked-in locks. Durable single-root
  // applies still record the resolved plugin set.
  if (!opts.dryRun && !applyBundle.resolution.root.ephemeral) {
    const manifest = findProjectConfig(projectRoot);
    writeLockfile(
      projectRoot,
      lockfileFromResolution(applyBundle.resolution, {
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
  if (gitOrigin) {
    const normalized = normalizeGitUrl(gitOrigin);
    const project = upsertProject({
      git_origin: normalized,
      name: projectNameFromUrl(gitOrigin),
      local_path: projectRoot,
    });

    const snapshotState: SnapshotState = {
      plugins: applyBundle.plugins.filter((p): p is NonNullable<typeof p> => p != null),
      resources: applyResources,
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
        resolvedPluginNames.length > 1
          ? `Before applying: ${resolvedPluginNames.join(" + ")}`
          : `Before applying: ${primaryPlugin.name}`,
      state: snapshotState,
    });

    applyConfiguredPluginToProject({
      project_id: project.id,
      configured_plugin_id: applyBundle.primaryConfiguredPluginId,
      platforms,
    });
  } else if (outputFormat === "human" && !opts.dryRun) {
    ui.warn("No git remote origin — configuration snapshot will not be stored.");
    ui.hint("git remote add origin <url>");
    ui.hint("Snapshots and drift detection require a git repository with origin configured.");
  }

  if (opts.dryRun) {
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({
        scope: "project",
        plugin: primaryPlugin.name,
        plugins: resolvedPluginNames,
        project_root: projectRoot,
        platforms: generated.map((result) => ({
          platform: result.platformId,
          files: result.files.map((file) => ({ path: file.path })),
        })),
      });
      return;
    }
    for (const result of generated) {
      const dryTag = ui.theme.muted("[dry run] ");
      const verdict = ui.theme.success(
        `${ui.icons.success} ${result.platformId} ${ui.icons.bullet} ${formatCount(result.files.length, "file")}`,
      );
      console.log(dryTag + verdict);
      for (const file of result.files) {
        console.log(ui.theme.muted(`  ${ui.icons.bullet} ${file.path}`));
      }
    }
    return;
  }

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: opts.onConflict,
    noInteractive: opts.noInteractive,
  });
  const conflictResolver =
    conflictPolicy === "prompt" ? promptMaterializationConflict : undefined;

  const platformResults: Array<{
    platform: string;
    written_files: string[];
    skipped_files: string[];
  }> = [];

  for (const result of generated) {
    const spin = createProgress(`Applying ${result.platformId}…`);
    const materialized = await materializeFiles(result.files, projectRoot, {
      conflictPolicy,
      conflictResolver,
    });
    spin.stop();
    if (materialized.cancelled) {
      ui.danger("Apply cancelled due to file conflicts");
      process.exitCode = 1;
      return;
    }
    platformResults.push({
      platform: result.platformId,
      written_files: materialized.writtenFiles,
      skipped_files: materialized.skippedFiles,
    });
    if (outputFormat === "human") {
      const writtenCount = materialized.writtenFiles.length;
      const skippedCount = materialized.skippedFiles.length;
      const summary =
        skippedCount > 0
          ? `wrote ${formatCount(writtenCount, "file")}, skipped ${formatCount(skippedCount, "file")}`
          : `wrote ${formatCount(writtenCount, "file")}`;
      console.log(
        ui.theme.success(
          `${ui.icons.success} ${result.platformId} ${ui.icons.bullet} ${summary}`,
        ),
      );
      for (const filePath of materialized.writtenFiles) {
        console.log(ui.theme.muted(`  ${ui.icons.bullet} ${filePath}`));
      }
      for (const filePath of materialized.skippedFiles) {
        console.log(
          ui.theme.muted(`  ${ui.icons.bullet} skipped ${filePath}`),
        );
      }
    }
  }

  if (outputFormat === "json") {
    printJson({
      scope: "project",
      plugin: primaryPlugin.name,
      plugins: resolvedPluginNames,
      project_root: projectRoot,
      platforms: platformResults,
    });
  }

  // Non-strict plugin warnings (shown after successful file writes).
  if (
    !opts.ignorePluginVersions &&
    !opts.strictPluginVersions &&
    mergedPluginPins.length > 0
  ) {
    for (const issue of pluginValidationIssues) {
      console.warn(ui.theme.warn(issue.message));
    }
  }
}


function shouldUseInteractivePluginEdit(input: {
  noInteractive?: boolean;
  format?: string;
}): boolean {
  return shouldUseWizard({
    interactive: true,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });
}

function printPluginEditJsonSnapshot(plugin: Plugin, rows: ReturnType<typeof buildPluginEditCandidates>): void {
  printJson({
    plugin: {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
    },
    attachments: rows
      .filter((row) => row.checked)
      .map((row) => ({
        key: attachmentKey(row),
        type: row.type,
        id: row.id.startsWith("plugin-candidate:") ? null : row.id,
        version_constraint: row.version_constraint ?? null,
      })),
  });
}

async function handlePluginEditCommand(
  name: string | undefined,
  opts: {
    type?: string;
    search?: string;
    showId?: boolean;
    all?: boolean;
    dryRun?: boolean;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
    add?: string[];
    remove?: string[];
    apply?: string;
    version?: string;
    embed?: boolean;
    sync?: boolean;
    environment?: string;
    clearEnvironment?: boolean;
    profile?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  const adds = opts.add ?? [];
  const removes = opts.remove ?? [];
  const environmentChange = opts.environment
    ? { kind: "set" as const, environment: opts.environment }
    : opts.clearEnvironment
      ? { kind: "clear" as const }
      : undefined;
  const profileChange = opts.profile === true
    ? { kind: "add" as const }
    : opts.profile === false
      ? { kind: "remove" as const }
      : undefined;
  const scripting = adds.length > 0
    || removes.length > 0
    || Boolean(opts.apply)
    || Boolean(environmentChange)
    || Boolean(profileChange);

  if (opts.environment && opts.clearEnvironment) {
    process.exitCode = 1;
    renderCliError(conflictingOptions("--environment", "--clear-environment"));
    return;
  }

  let typeFilter: ResourceType | undefined;
  if (scripting) {
    if (opts.type) {
      try {
        validatePluginAttachmentType(opts.type);
      } catch (error) {
        process.exitCode = 1;
        ui.danger(error instanceof Error ? error.message : String(error));
        return;
      }
    }
  } else if (isPluginAttachmentOnlyType(opts.type)) {
    typeFilter = undefined;
  } else {
    const resolvedType = resolveResourceListType(undefined, opts.type);
    if (resolvedType === "conflict") {
      ui.danger(`Conflicting type filters: ${opts.type}`);
      return;
    }
    if (resolvedType === "invalid") {
      ui.danger(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
      return;
    }
    typeFilter = resolvedType;
  }

  const resolvedName = scripting
    ? name
    : name ?? await resolvePluginMutationTarget({
        pluginName: name,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which plugin do you want to edit?",
      });

  if (!resolvedName) {
    process.exitCode = 1;
    ui.danger(
      scripting || listPlugins().length > 0
        ? "error: missing required argument 'name'"
        : `No plugins found. Create one with \`${formatCommand("plugin create <name>")}\` first.`,
    );
    return;
  }

  const plugin = getPlugin(resolvedName);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${resolvedName}`);
    return;
  }

  assertAuthored(plugin.id, "edit");

  const candidates = buildPluginEditCandidates(plugin);

  if (scripting) {
    try {
      if (profileChange) {
        if (opts.dryRun) {
          const action = profileChange.kind === "add"
            ? "add profile tag"
            : "remove profile tag";
          ui.info(`Would ${action} on ${formatPluginLabel(plugin)}`);
        } else {
          const nextTags = profileChange.kind === "add"
            ? [...new Set([...plugin.tags, PROFILE_PLUGIN_TAG])]
            : plugin.tags.filter((tag) => tag !== PROFILE_PLUGIN_TAG);
          setPluginTags(plugin.id, nextTags);
          if (format === "json") {
            printJson({
              plugin: plugin.name,
              tags: nextTags,
              profile: profileChange.kind === "add",
            });
          } else if (profileChange.kind === "add") {
            ui.success(
              `Tagged ${ui.theme.accent(formatPluginLabel(plugin))} as a profile`,
            );
          } else {
            ui.success(
              `Removed profile tag from ${ui.theme.accent(formatPluginLabel(plugin))}`,
            );
          }
        }
      }

      if (environmentChange) {
        if (opts.dryRun) {
          const action = environmentChange.kind === "set"
            ? `set default environment to ${environmentChange.environment}`
            : "clear default environment";
          ui.info(`Would ${action} on ${formatPluginLabel(plugin)}`);
        } else if (environmentChange.kind === "set") {
          const result = setPluginEnvironmentCommand(resolvedName, environmentChange.environment);
          if (format === "json") {
            printJson(result);
          } else {
            ui.success(
              `Set default environment on ${ui.theme.accent(formatPluginLabel(plugin))}`,
            );
          }
        } else {
          const result = unsetPluginEnvironmentCommand(resolvedName);
          if (format === "json") {
            printJson(result);
          } else {
            ui.success(
              `Cleared default environment on ${ui.theme.accent(formatPluginLabel(plugin))}`,
            );
          }
        }
      }

      const attachmentScripting = adds.length > 0 || removes.length > 0 || Boolean(opts.apply);
      if (!attachmentScripting) {
        return;
      }

      if (opts.apply) {
        const raw = readFileSync(opts.apply, "utf8");
        const attachments = parsePluginEditApplyFile(raw);
        const pending = buildPendingFromApplySpec(candidates, attachments);
        const result = await applyPluginEdit({
          plugin,
          initial: candidates,
          pending,
          dryRun: opts.dryRun,
        });
        printPluginEditSuccess(plugin, result, opts.dryRun);
        return;
      }

      const attachmentType = validatePluginAttachmentType(opts.type);
      const result = await applyPluginEditScripting({
        plugin,
        adds: adds.map((selector) => ({
          selector,
          type: attachmentType,
          version: opts.version,
          embed: opts.embed,
          sync: opts.sync,
        })),
        removes: removes.map((selector) => ({
          selector,
          type: attachmentType,
        })),
        dryRun: opts.dryRun,
      });

      if (opts.dryRun) {
        printPluginEditSuccess(plugin, result, true);
        return;
      }

      for (const message of result.messages) {
        ui.success(ui.theme.accent(message));
      }
      return;
    } catch (error) {
      if (error instanceof PluginAttachmentHintError) {
        process.exitCode = 1;
        ui.danger(error.message, { hints: error.hints });
        return;
      }
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  if (format === "json" && !shouldUseInteractivePluginEdit(opts)) {
    printPluginEditJsonSnapshot(plugin, candidates);
    return;
  }

  if (!shouldUseInteractivePluginEdit(opts)) {
    process.exitCode = 1;
    ui.danger(
      `plugin edit requires an interactive terminal, or use \`${formatCommand("plugin edit <name> --add <selector> --type <type>")}\`, \`--remove\`, \`--apply <file>\`, \`--environment <name>\`, or \`--clear-environment\` for scripting.`,
    );
    return;
  }

  try {
    const pending = await runPluginEditWizard({
      plugin,
      typeFilter,
      search: opts.search,
      showId: opts.showId,
      showAll: opts.all,
    });
    if (!pending) {
      process.exitCode = 1;
      return;
    }

    const result = await applyPluginEdit({
      plugin,
      initial: candidates,
      pending,
      dryRun: opts.dryRun,
    });
    printPluginEditSuccess(plugin, result, opts.dryRun);
  } catch (error) {
    if (isPromptCancellationError(error)) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function printPluginEditSuccess(
  plugin: Plugin,
  result: { added: string[]; removed: string[] },
  dryRun?: boolean,
): void {
  const label = formatPluginLabel(plugin);
  const summary = `+${result.added.length} added, −${result.removed.length} removed`;
  if (dryRun) {
    ui.success(`Dry run for plugin ${ui.theme.accent(label)} ${ui.icons.bullet} ${summary} (no changes written)`);
    return;
  }
  ui.success(`Updated plugin ${ui.theme.accent(label)} ${ui.icons.bullet} ${summary}`);
}

async function handlePluginEditorCommand(
  name: string | undefined,
  opts: {
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  const resolvedName = name ?? await resolvePluginMutationTarget({
    pluginName: name,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    message: "Which plugin definition do you want to open?",
  });
  if (!resolvedName) {
    process.exitCode = 1;
    ui.danger(
      listPlugins().length > 0
        ? "error: missing required argument 'name'"
        : `No plugins found. Create one with \`${formatCommand("plugin create <name>")}\` first.`,
    );
    return;
  }

  const plugin = getPlugin(resolvedName);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${resolvedName}`);
    return;
  }

  try {
    assertAuthored(plugin.id, "edit");
    const definitionPath = exportPluginDefinition(plugin);
    if (format === "json") {
      printJson({
        plugin: formatPluginLabel(plugin),
        path: definitionPath,
      });
      return;
    }

    openPathInSystemEditor(definitionPath);
    ui.success(`Opened plugin definition ${ui.theme.accent(definitionPath)}`);
    ui.info(
      `After editing, import changes with \`${formatCommand(`migrate import ${definitionPath}`)}\`.`,
    );
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof PluginProvenanceError) {
      ui.danger(error.message, { hints: error.hints });
      return;
    }
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

function resolveApplyHarnessTargets(
  projectRoot: string,
  opts: ApplyCommandOpts,
  fromManifest: boolean,
): string[] {
  const resolved = resolveProjectCompileTargets({
    projectRoot,
    mode: fromManifest || opts.failClosedTargets ? "install" : "apply-plugin",
    ...(opts.target ? { cliTarget: opts.target } : {}),
    ...(opts.all ? { cliAll: true } : {}),
    ...(opts.harness ? { cliHarness: opts.harness } : {}),
    ...(!fromManifest && !opts.failClosedTargets
      ? { preferenceHarnesses: collectApplyPreferenceHarnesses(projectRoot) }
      : {}),
  });
  for (const warning of resolved.warnings) {
    ui.warn(warning);
  }
  return resolved.harnessTargets;
}


function parsePluginSourceConflictPolicy(
  value: string | undefined,
): PluginSourceConflictPolicy | undefined {
  if (!value) return undefined;
  if (value === "cancel" || value === "merge" || value === "overwrite") {
    return value;
  }
  throw new Error(
    `Invalid --on-conflict value: ${value}. Use cancel, merge, or overwrite.`,
  );
}

function handlePluginCutCommand(
  pluginSelector: string,
  opts: { version: string; format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  const plugin = getPlugin(pluginSelector);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${pluginSelector}`);
    return;
  }

  try {
    assertAuthored(plugin.id, "cut");
    const cut = cutPluginVersion({ pluginId: plugin.id, newVersion: opts.version });
    if (format === "json") {
      printJson(cut);
      return;
    }
    ui.success(`Cut plugin ${ui.theme.accent(formatPluginLabel(cut))}`);
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof PluginProvenanceError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    if (err instanceof PluginVersionError) {
      ui.danger(err.message);
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

function handlePluginDiffCommand(
  left: string,
  right: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    const report = diffPlugins(left, right);
    if (format === "json") {
      printJson(report);
      return;
    }
    if (report.changes.length === 0) {
      ui.success("No differences.");
      return;
    }

    const changeEntries = report.changes.map((c) => ({
      kind: (c.change === "reordered" ? "modified" : c.change) as "added" | "removed" | "modified",
      scope: c.kind,
      key: c.key,
      detail: c.change,
    }));

    const added = changeEntries.filter((c) => c.kind === "added").length;
    const removed = changeEntries.filter((c) => c.kind === "removed").length;
    const modified = changeEntries.filter((c) => c.kind === "modified").length;

    console.log(`DIFF  ${report.left} ↔ ${report.right}`);
    console.log("");
    console.log(ui.renderChangeList(changeEntries));
    console.log("");
    console.log(
      `${report.changes.length} changes ${ui.icons.bullet} ${added} added ${ui.icons.bullet} ${removed} removed ${ui.icons.bullet} ${modified} modified`,
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handlePluginDoctorCommand(
  name: string | undefined,
  opts: {
    check?: string[];
    format?: string;
    listChecks?: boolean;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    if (opts.listChecks) {
      const checks = listPluginDoctorChecks().map((check) => ({
        id: check.id,
        description: check.description,
      }));

      if (format === "json") {
        printJson(checks);
        return;
      }

      ui.table.print({
        columns: [
          { key: "id", header: "CHECK", width: 24 },
          { key: "description", header: "DESCRIPTION", width: 56 },
        ],
        rows: checks,
        summary: `${checks.length} checks`,
      });
      return;
    }

    const resolvedName = name ?? await resolvePluginMutationTarget({
      pluginName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which plugin do you want to diagnose?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger(
        listPlugins().length > 0
          ? "error: missing required argument 'name'"
          : `No plugins found. Create one with \`${formatCommand("plugin create <name>")}\` first.`,
      );
      return;
    }

    const report = runPluginDoctor({
      nameOrId: resolvedName,
      checkIds: opts.check,
    });

    if (format === "json") {
      printJson(report);
      if (!report.valid) process.exitCode = 1;
      return;
    }

    // Human format: show all checks with pass/fail markers
    const allChecks = listPluginDoctorChecks().filter((check) => 
      opts.check?.length ? opts.check.includes(check.id) : true
    );

    const rows: Array<{ check: string; result: string; message: string }> = [];
    const findingsByCheck = new Map<string, typeof report.results>();
    
    for (const result of report.results) {
      if (!findingsByCheck.has(result.check)) {
        findingsByCheck.set(result.check, []);
      }
      const findings = findingsByCheck.get(result.check);
      if (findings) {
        findings.push(result);
      }
    }

    for (const check of allChecks) {
      const findings = findingsByCheck.get(check.id);
      if (findings && findings.length > 0) {
        // Show each finding as a separate row
        for (const finding of findings) {
          rows.push({
            check: check.id,
            result: finding.severity === "error" ? "✗ error" : "✗ warn",
            message: finding.message,
          });
        }
      } else {
        // No findings - show pass
        rows.push({
          check: check.id,
          result: "✓ pass",
          message: "",
        });
      }
    }

    ui.table.print({
      columns: [
        { key: "check", header: "CHECK", width: 22 },
        { key: "result", header: "RESULT", width: 12 },
        { key: "message", header: "MESSAGE", width: 44 },
      ],
      rows,
      summary: report.valid ? `${report.plugin}: valid` : `${report.plugin}: invalid`,
    });
    if (!report.valid) {
      process.exitCode = 1;
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handlePluginFromProjectCommand(
  name: string | undefined,
  opts: {
    project: string;
    description?: string;
    harness?: string;
    interactive?: boolean;
    noInteractive?: boolean;
    format?: string;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  try {
    const resolvedName = name ?? await (shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
      missingRequiredArgs: true,
    })
      ? runPluginFromProjectWizard()
      : Promise.resolve(undefined));

    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger("error: missing required argument 'name'");
      return;
    }

    const projectRoot = resolve(opts.project);

    // First, preview what would happen
    const { previewPluginFromProject } = await import("../../services/plugin-from-project.js");
    const preview = await previewPluginFromProject({
      name: resolvedName,
      projectRoot,
      platform: opts.harness,
    });

    // If plugin exists and has conflicts, prompt for resolution
    if (preview.pluginExists && (preview.conflicts.length > 0 || preview.newResources.length > 0)) {
      const canPrompt = shouldUseWizard({
        interactive: true, // Conflicts require interactive resolution
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: false,
      });

      if (!canPrompt) {
        process.exitCode = 1;
        const parts = [];
        if (preview.conflicts.length > 0) {
          parts.push(`${preview.conflicts.length} conflicting resource(s)`);
        }
        if (preview.newResources.length > 0) {
          parts.push(`${preview.newResources.length} new resource(s)`);
        }
        ui.danger(`Plugin "${resolvedName}" already exists with ${parts.join(" and ")}. Use --interactive to resolve conflicts.`);
        return;
      }

      // Show preview
      ui.info(`\nPlugin "${resolvedName}" already exists.`);
      if (preview.conflicts.length > 0) {
        ui.info(`Conflicts: ${preview.conflicts.length} resource(s) would be overwritten`);
      }
      if (preview.newResources.length > 0) {
        ui.info(`New resources: ${preview.newResources.length} would be added`);
      }
      ui.info(`Total imports: ${preview.totalImports}\n`);

      const action = await promptForChoice({
        message: "How do you want to proceed?",
        choices: [
          { name: "Overwrite conflicting resources", value: "overwrite" },
          { name: "Create with a different name", value: "rename" },
          { name: "Cancel", value: "cancel" },
        ],
      });

      if (action === "cancel") {
        ui.info("Operation cancelled.");
        return;
      }

      if (action === "rename") {
        const newName = await promptForValue({
          message: "Enter new plugin name",
          default: `${resolvedName}-copy`,
        });

        const result = await createPluginFromProject({
          name: newName,
          description: opts.description,
          projectRoot,
          platform: opts.harness,
        });

        ui.success(
          `Created plugin ${ui.theme.accent(result.plugin.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }

      if (action === "overwrite") {
        const result = await createPluginFromProject({
          name: resolvedName,
          description: opts.description,
          projectRoot,
          platform: opts.harness,
          conflictStrategy: "overwrite",
        });

        ui.success(
          `Updated plugin ${ui.theme.accent(result.plugin.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }
    }

    // No conflicts or plugin doesn't exist - proceed normally
    const result = await createPluginFromProject({
      name: resolvedName,
      description: opts.description,
      projectRoot,
      platform: opts.harness,
    });

    ui.success(
      `Created plugin ${ui.theme.accent(result.plugin.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handlePluginCreateCommand(
  name: string,
  opts: {
    description?: string;
    tags?: string;
    version?: string;
    from?: string;
    skill?: string;
    all?: boolean;
    excludeCategory?: string[];
    onConflict?: string;
    install?: boolean;
    global?: boolean;
    project?: boolean | string;
    harness?: string;
    method?: string;
    dryRun?: boolean;
    format?: string;
    interactive?: boolean;
    yes?: boolean;
    profile?: boolean;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const db = getDb();
  initializeSchema(db);
  const tags = opts.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [];
  if (opts.profile) {
    tags.push(PROFILE_PLUGIN_TAG);
  }
  const version = opts.version ?? "1.0.0";

  if (!opts.from) {
    const plugin = createPlugin({
      name,
      version,
      description: opts.description,
      tags,
    });
    if (format === "json") {
      printJson(plugin);
      return;
    }
    ui.success(`Created plugin ${ui.theme.accent(formatPluginLabel(plugin))}`);
    return;
  }

  if (opts.install && !opts.global && opts.project === undefined) {
    throw new Error("Pass --global or --project when using --install.");
  }
  if (opts.global && opts.project !== undefined) {
    throw new Error("Pass only one of --global or --project.");
  }

  const method = opts.method === "copy"
    ? "copy"
    : opts.method === "symlink" || !opts.method
      ? "symlink"
      : (() => {
          throw new Error(`Invalid --method value: ${opts.method}. Use symlink or copy.`);
        })();

  const harnesstapDir = getHarnesstapDir();
  const homeRoot = resolveHomeRoot();
  const skillNames = parseCommaSeparatedList(opts.skill);
  const excludeCategories = [
    ...(opts.excludeCategory ?? []),
  ].flatMap((entry) => entry.split(",").map((part) => part.trim()).filter(Boolean));
  const onConflictFlag = parsePluginSourceConflictPolicy(opts.onConflict);
  const harnesses = parseCommaSeparatedList(opts.harness);
  if (harnesses) {
    assertSupportedHarnessTargets(harnesses);
  }

  const resolvedPackage = resolveSkillPackageCheckout(opts.from, harnesstapDir);
  const shouldPrompt = shouldUseWizard({
    noInteractive: opts.yes,
    interactive: opts.interactive,
    format,
    missingRequiredArgs: !opts.all && (!skillNames || skillNames.length === 0),
  });

  const wizard = await runPluginCreateFromSourceWizard({
    pluginName: name,
    pluginVersion: version,
    discovered: resolvedPackage.discovered,
    skillNames,
    all: opts.all,
    excludeCategories: excludeCategories.length > 0 ? excludeCategories : undefined,
    onConflict: onConflictFlag,
    shouldPrompt,
  });

  if (wizard.cancelled) {
    ui.info("Operation cancelled.");
    return;
  }

  const installScope = opts.global
    ? { scope: "global" as const }
    : opts.project !== undefined
      ? {
          scope: "project" as const,
          projectRoot: typeof opts.project === "string" ? opts.project : ".",
        }
      : undefined;

  const result = await createPluginFromSource({
    name,
    source: opts.from,
    version,
    description: opts.description,
    tags,
    skillNames: wizard.skillNames,
    all: wizard.all,
    excludeCategories: excludeCategories.length > 0 ? excludeCategories : undefined,
    onConflict: onConflictFlag ?? wizard.onConflict,
    install: Boolean(opts.install),
    scope: installScope?.scope,
    projectRoot: installScope?.projectRoot,
    method,
    harnesses,
    dryRun: opts.dryRun,
    homeRoot,
    harnesstapDir,
  });

  const payload = {
    plugin: result.plugin.name,
    version: result.plugin.version,
    source: opts.from,
    namespace: result.namespace,
    discovered: result.importedSkills,
    attached: result.attachedSkills,
    installed: result.installedSkills,
    conflict_policy: result.conflictPolicy,
    snapshot_id: result.snapshotId,
  };

  if (format === "json") {
    printJson(payload);
    return;
  }

  if (opts.dryRun) {
    ui.success(
      `Dry run ${ui.icons.hint} would configure plugin ${ui.theme.accent(formatPluginLabel(result.plugin))} with ${formatCount(result.attachedSkills.length, "skill")} from ${result.namespace}`,
    );
    return;
  }

  const actionLabel = result.conflictPolicy === "merge"
    ? "Updated"
    : result.conflictPolicy === "overwrite"
      ? "Replaced"
      : "Created";
  ui.success(
    `${actionLabel} plugin ${ui.theme.accent(formatPluginLabel(result.plugin))} ${ui.icons.bullet} ${formatCount(result.attachedSkills.length, "skill")} attached from ${result.namespace}`,
  );
  console.log("");
  ui.kvBlock([
    { key: "Attached", value: result.attachedSkills.join(", ") || "—" },
    ...(result.installedSkills.length > 0
      ? [{ key: "Installed", value: result.installedSkills.join(", ") }]
      : []),
    { key: "Run", value: formatCommand(`plugin show ${result.plugin.name}`) },
  ]);
}

configurePluginListInteractiveDeps({
  applyToProject: async (selectors, applyOpts) => {
    await handleProjectApplyCommand(selectors, {
      project: resolveCatalogSearchProjectRoot(),
      account: applyOpts.account,
      baseUrl: applyOpts.baseUrl,
      format: applyOpts.format,
      noInteractive: applyOpts.noInteractive,
    });
  },
  onInstall: async (selector, installOpts) => {
    await handlePluginInstallCommand(selector, {
      as: installOpts.as,
      org: installOpts.org,
      catalog: installOpts.catalog,
      version: installOpts.version,
      account: installOpts.account,
      baseUrl: installOpts.baseUrl,
      format: installOpts.format,
      interactive: installOpts.interactive,
      noInteractive: installOpts.noInteractive,
    });
  },
  onEdit: async (name, editOpts) => {
    await handlePluginEditCommand(name, {
      format: editOpts.format,
      interactive: true,
    });
  },
  onDelete: async (name, _deleteOpts) => {
    await deleteLocalPluginByName(name);
  },
  onEditRemote: async (catalogPlugin, selection, remoteOpts) => {
    try {
      await editCatalogPluginComposition(catalogPlugin, selection, {
        account: remoteOpts.account,
        baseUrl: remoteOpts.baseUrl,
        onEditLocal: async (name) => {
          await handlePluginEditCommand(name, {
            format: remoteOpts.format,
            interactive: true,
          });
        },
        onPublish: async (pluginName, catalogSelector, publishOpts) => {
          await handlePluginPublishCommand(pluginName, catalogSelector, {
            account: publishOpts.account,
            format: remoteOpts.format,
          });
        },
      });
    } catch (err) {
      process.exitCode = 1;
      renderCliError(err);
    }
  },
  onDeleteRemote: async (catalogPlugin, remoteOpts) => {
    try {
      await deleteCatalogPlugin(catalogPlugin, {
        account: remoteOpts.account,
        baseUrl: remoteOpts.baseUrl,
      });
    } catch (err) {
      process.exitCode = 1;
      renderCliError(err);
    }
  },
});


async function resolveMarketplacePinPluginName(
  pluginOpt: string | undefined,
  shouldPrompt: boolean,
): Promise<string | undefined> {
  const trimmed = pluginOpt?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (!shouldPrompt) {
    return undefined;
  }

  const plugins = listPlugins();
  if (plugins.length > 0) {
    return promptForChoice({
      message: "Select a plugin for the plugin pin",
      choices: plugins.map((plugin) => ({
        name: plugin.name,
        value: plugin.name,
      })),
    });
  }

  return promptForValue({
    message: "Enter a plugin name for the plugin pin",
  });
}

function printPluginSearchResults(
  plugins: CatalogPlugin[],
  format: OutputFormat,
): void {
  if (format === "json") {
    printJson({ plugins });
    return;
  }

  if (plugins.length === 0) {
    ui.dim("No plugins matched your search.");
    return;
  }

  ui.table.print({
    columns: [
      { key: "name", header: "NAME", width: 24 },
      { key: "ref", header: "REF", width: 32 },
      { key: "version", header: "VERSION", width: 12 },
      { key: "description", header: "DESCRIPTION", width: 40 },
    ],
    rows: plugins.map((plugin) => ({
      name: plugin.name,
      ref: plugin.ref,
      version: plugin.version ?? "",
      description: plugin.description ?? "",
    })),
    summary: `${plugins.length} plugin${plugins.length === 1 ? "" : "s"}`,
    empty: "No plugins matched your search.",
  });
}

function printMarketplacePinAddResult(
  result: AddPluginFromMarketplaceResult,
  format: OutputFormat,
): void {
  if (format === "json") {
    printJson(result);
    return;
  }

  if (result.status === "already_attached") {
    ui.info(`Plugin pin already attached: ${result.ref} on ${result.pluginName}`);
    return;
  }

  ui.success(`Attached plugin pin ${result.ref} to plugin ${result.pluginName}`);
}

async function addMarketplacePluginPin(
  ref: string,
  pluginName: string,
  format: OutputFormat,
): Promise<void> {
  const result = await addPluginFromMarketplace({
    harnesstapDir: getHarnesstapDir(),
    homeRoot: resolveHomeRoot(),
    projectRoot: process.cwd(),
    ref,
    pluginName,
  });
  printMarketplacePinAddResult(result, format);
}

async function handlePluginSearchCommand(
  query: string | undefined,
  opts: {
    refresh?: boolean;
    format?: string;
    plugin?: string;
    noInteractive?: boolean;
  } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const harnesstapDir = getHarnesstapDir();
  const useBrowsePicker = shouldUseBrowsePicker({
    noInteractive: opts.noInteractive,
    format: opts.format,
  });

  if (useBrowsePicker) {
    const plugins = searchCatalogPlugins(harnesstapDir, query ?? "", {
      refresh: opts.refresh,
    });
    if (plugins.length === 0) {
      throw new Error(
        "No plugins found. Try plugin search <query> --refresh.",
      );
    }

    const selectedRef = await promptForSearchableChoice({
      message: "Select a plugin to add",
      choices: plugins.map((plugin) => ({
        name: plugin.description
          ? `${plugin.name} — ${plugin.description}`
          : plugin.name,
        value: plugin.ref,
        description: plugin.version ? `v${plugin.version}` : undefined,
      })),
    });

    const pluginName = await resolveMarketplacePinPluginName(opts.plugin, true);
    if (!pluginName) {
      process.exitCode = 2;
      renderCliError(
        new CliUsageError(
          "Plugin is required. Pass --plugin <name> to choose which plugin receives the plugin pin.",
          ["Run `ht plugin search --help` for usage."],
          2,
        ),
      );
      return;
    }

    await addMarketplacePluginPin(selectedRef, pluginName, format);
    return;
  }

  const plugins = searchCatalogPlugins(harnesstapDir, query ?? "", {
    refresh: opts.refresh,
  });
  printPluginSearchResults(plugins, format);
}

function handlePluginAddDependencyCommand(
  ref: string,
  opts: {
    to?: string;
    layer?: string;
    format?: string;
  } = {},
): void {
  if (opts.layer && !opts.to) {
    ui.warn("`--layer` is deprecated; use `--to` instead.");
  }

  const targetName = opts.to?.trim() || opts.layer?.trim();
  if (!targetName) {
    process.exitCode = 2;
    renderCliError(
      new CliUsageError(
        "Plugin is required. Pass --to <plugin> to choose which plugin receives the dependency.",
        ["Run `ht plugin add --help` for usage."],
        2,
      ),
    );
    return;
  }

  const plugin = getPlugin(targetName);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${targetName}`);
    return;
  }

  addDependency(plugin.id, ref);
  const format = parseOutputFormat(opts.format);
  if (format === "json") {
    printJson({ ref, to: plugin.name });
    return;
  }
  ui.success(`Added dependency ${ref} to plugin ${formatPluginLabel(plugin)}`);
}

export function registerPluginCommands(root: Command): void {
  const pluginCmd = configureCommandGroup(
  root
    .command("plugin")
    .alias("l")
    .description("Manage plugins (named bundles of resources that can be applied to a project)"),
);

pluginCmd
  .command("create")
  .argument("<name>", "Plugin name")
  .option("-d, --description <text>", "Plugin description")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--version <semver>", "Plugin version (semver)", "1.0.0")
  .option(
    "--from <source>",
    "Skill package source (owner/repo, git URL, or local path)",
  )
  .option("--skill <names>", "Comma-separated skills to attach")
  .option("--all", "Attach all discovered skills")
  .option(
    "--exclude-category <names>",
    "Exclude skill categories (repeatable or comma-separated)",
    collectRepeatedOption,
    [],
  )
  .option(
    "--on-conflict <policy>",
    "When plugin exists: cancel, merge, or overwrite (default: cancel)",
  )
  .option("--install", "Install selected skills to hub paths")
  .option("--global", "Install globally when --install is set")
  .option("--project [path]", "Install to project when --install is set")
  .option("--harness <slugs>", "Comma-separated harness slugs for --install")
  .option("--method <mode>", "Install method when --install is set: symlink or copy")
  .option("--dry-run", "Preview plugin configuration without writing")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("-y, --yes", "Skip interactive prompts")
  .option("--profile", "Tag the new plugin as a switchable profile")
  .description("Create a plugin from scratch, a skill package, or a scan")
  .action(
    async (
      name: string,
      opts: {
        description?: string;
        tags?: string;
        version?: string;
        from?: string;
        skill?: string;
        all?: boolean;
        excludeCategory?: string[];
        onConflict?: string;
        install?: boolean;
        global?: boolean;
        project?: boolean | string;
        harness?: string;
        method?: string;
        dryRun?: boolean;
        format?: string;
        interactive?: boolean;
        yes?: boolean;
        profile?: boolean;
      },
    ) => {
      try {
        await handlePluginCreateCommand(name, opts);
      } catch (error) {
        if (isPromptCancellationError(error)) {
          ui.info("Operation cancelled.");
          return;
        }
        process.exitCode = 1;
        renderCliError(error);
      }
    },
  );

pluginCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in human-readable tables")
  .option("-s, --search <query>", "Filter by name, description, or tags (local and remote)")
  .option("--local-only", "List only local plugins")
  .option("--remote-only", "List only remote catalog plugins")
  .option("--tag <tag>", "Filter remote catalog plugins by tag")
  .option("--account <name>", "Cloud account to use for remote listing")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--no-interactive", "Disable interactive wizards")
  .option("--interactive", "Enable interactive wizards")
  .description("List local plugins and optionally search the remote catalog")
  .action(async (opts: {
    format?: string;
    showId?: boolean;
    search?: string;
    localOnly?: boolean;
    remoteOnly?: boolean;
    tag?: string;
    account?: string;
    baseUrl?: string;
    noInteractive?: boolean;
    interactive?: boolean;
  }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      await handlePluginListCommand({
        search: opts.search,
        localOnly: opts.localOnly,
        remoteOnly: opts.remoteOnly,
        tag: opts.tag,
        showId: opts.showId,
        format: parseOutputFormat(opts.format),
        account: opts.account,
        baseUrl: opts.baseUrl,
        noInteractive: opts.noInteractive,
        interactive: opts.interactive,
      });
    } catch (error) {
      if (isPromptCancellationError(error)) {
        process.exitCode = 1;
        return;
      }
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCmd
  .command("show")
  .argument("[name]", "Plugin name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .description("Show plugin details, resources, and plugin pins")
  .action(async (name: string | undefined, opts: { format?: string; showId?: boolean; interactive?: boolean; noInteractive?: boolean }) => {
    const resolvedName = name ?? await resolvePluginMutationTarget({
      pluginName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which plugin do you want to show?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      if (listPlugins().length > 0) {
        renderCliError(missingRequiredArg("name", "plugin show"));
      } else {
        ui.danger(`No plugins found. Create one with \`${formatCommand("plugin create <name>")}\` first.`);
      }
      return;
    }
    handlePluginShowCommand(resolvedName, opts);
  });

pluginCmd
  .command("edit")
  .argument("[name]", "Plugin name or ID")
  .option("-t, --type <type>", `Attachment or filter type (${PLUGIN_ATTACHMENT_TYPES.join(", ")})`)
  .option("-s, --search <query>", "Pre-fill search filter (interactive mode)")
  .option("--show-id", "Show IDs in tables")
  .option("--all", "Show all resources per type (default: first 10 per type)")
  .option("--add <selector>", "Add attachment (repeatable; scripting mode)", collectRepeatedOption, [])
  .option("--remove <selector>", "Remove attachment (repeatable; scripting mode)", collectRepeatedOption, [])
  .option("--apply <file>", "Apply membership from JSON file (scripting mode)")
  .option("--version <constraint>", "Version constraint for plugin or plugin attachments")
  .option("--embed", "Mark plugin pin as embed-on-export when adding")
  .option("--sync", "Sync plugin resource immediately after add")
  .option("--environment <name>", "Set default environment for plugin apply cascade")
  .option("--clear-environment", "Clear default environment from plugin")
  .option("--profile", "Tag the plugin as a switchable profile")
  .option("--no-profile", "Remove the profile tag from the plugin")
  .option("--dry-run", "Preview changes without writing")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Edit plugin composition and default environment (interactive or scripting)")
  .action(async (name: string | undefined, opts: {
    type?: string;
    search?: string;
    showId?: boolean;
    all?: boolean;
    add?: string[];
    remove?: string[];
    apply?: string;
    version?: string;
    embed?: boolean;
    sync?: boolean;
    environment?: string;
    clearEnvironment?: boolean;
    profile?: boolean;
    dryRun?: boolean;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  }) => {
    try {
      await handlePluginEditCommand(name, opts);
    } catch (error) {
      process.exitCode = 1;
      if (
        error instanceof PluginAttachmentHintError
        || error instanceof PluginProvenanceError
      ) {
        ui.danger(error.message, { hints: error.hints });
        return;
      }
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCmd
  .command("editor")
  .argument("[name]", "Plugin name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Open a plugin definition file in your system editor")
  .action(async (name: string | undefined, opts: {
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  }) => {
    await handlePluginEditorCommand(name, opts);
  });

pluginCmd
  .command("delete")
  .argument("[name]", "Plugin name, name@version selector, or ID")
  .option("-s, --search <query>", "Filter plugins in the delete wizard")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Delete a local plugin and its composition attachments")
  .action(async (name: string | undefined, opts: { search?: string; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const useWizard = shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      });
      const selectors = name
        ? [name]
        : useWizard
          ? await runPluginDeleteWizard({ search: opts.search })
          : [];

      if (selectors.length === 0) {
        throw !name && useWizard
          ? new Error("No plugins selected for deletion")
          : missingRequiredArg("name", "plugin delete");
      }

      for (const resolvedName of selectors) {
        const plugin = getPlugin(resolvedName);
        if (!plugin) {
          process.exitCode = 1;
          ui.danger(`Plugin not found: ${resolvedName}`);
          return;
        }
        if (!deletePlugin(plugin.id)) {
          throw new Error(`Failed to delete plugin ${formatPluginLabel(plugin)}`);
        }
        ui.success(`Deleted plugin ${ui.theme.accent(formatPluginLabel(plugin))}`);
      }
    } catch (err) {
      process.exitCode = 1;
      renderCliError(err);
    }
  });

pluginCmd
  .command("search")
  .argument("[query]", "Search query for marketplace plugins")
  .option("--refresh", "Refresh marketplace catalogs before searching")
  .option("--plugin <name>", "Plugin to attach the selected plugin pin to")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--no-interactive", "Disable interactive browse picker")
  .description("Search marketplace catalogs for plugins")
  .action(async (query: string | undefined, opts: {
    refresh?: boolean;
    format?: string;
    plugin?: string;
    noInteractive?: boolean;
  }) => {
    try {
      await handlePluginSearchCommand(query, opts);
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      process.exitCode = 1;
      renderCliError(error);
    }
  });

pluginCmd
  .command("add")
  .argument("<ref>", "Dependency ref (local name, org/catalog/name, name@marketplace, or git URL)")
  .option("--to <plugin>", "Plugin that receives the dependency")
  .addOption(new Option("--layer <plugin>", "Deprecated alias for --to").hideHelp())
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Add a dependency to a plugin")
  .action((ref: string, opts: { to?: string; layer?: string; format?: string }) => {
    try {
      handlePluginAddDependencyCommand(ref, opts);
    } catch (error) {
      process.exitCode = 1;
      renderCliError(error);
    }
  });

const pluginCatalogCmd = pluginCmd
  .command("catalog")
  .description("Manage publish catalog bindings and connected pull sources");

pluginCatalogCmd
  .command("list")
  .alias("ls")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show default and connected catalog sources")
  .action(async (opts: { baseUrl?: string; format?: string }) => {
    try {
      await handlePluginCatalogListCommand({
        baseUrl: opts.baseUrl,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .command("connect")
  .argument("<target>", "org <slug> or plugin <org/catalog/plugin>")
  .argument("[value]", "Organization slug or org/catalog/plugin selector")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .description("Connect an org or individual public plugin to the local catalog scope")
  .action(async (target: string, value: string | undefined, opts: { baseUrl?: string }) => {
    try {
      if (target === "org") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'slug' for org connect");
          return;
        }
        await handlePluginCatalogConnectOrgCommand(value, opts);
        return;
      }
      if (target === "plugin") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/catalog/plugin' for plugin connect");
          return;
        }
        await handlePluginCatalogConnectPluginCommand(value, opts);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'plugin'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .command("disconnect")
  .argument("<target>", "org <slug> or plugin <org/catalog/plugin>")
  .argument("[value]", "Organization slug or org/catalog/plugin selector")
  .description("Disconnect a connected org or plugin from the local catalog scope")
  .action(async (target: string, value: string | undefined) => {
    try {
      if (target === "org") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'slug' for org disconnect");
          return;
        }
        await handlePluginCatalogDisconnectOrgCommand(value);
        return;
      }
      if (target === "plugin") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/catalog/plugin' for plugin disconnect");
          return;
        }
        await handlePluginCatalogDisconnectPluginCommand(value);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'plugin'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .command("register")
  .argument("<selector>", "Publish catalog org/catalog or account@org/catalog")
  .option("--account <name>", "Cloud account for this catalog")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Register a publish catalog on this machine")
  .action(async (selector: string, opts: { account?: string; format?: string }) => {
    try {
      await handlePluginCatalogRegisterCommand(selector, {
        account: opts.account,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .command("unregister")
  .argument("<selector>", "Publish catalog org/catalog")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Remove a publish catalog from this machine")
  .action(async (selector: string, opts: { format?: string }) => {
    try {
      await handlePluginCatalogUnregisterCommand(selector, {
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .command("registered")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List registered publish catalogs")
  .action(async (opts: { format?: string }) => {
    try {
      await handlePluginCatalogRegisteredCommand({
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .command("bindings [plugin]")
  .option(
    "--add <selector>",
    "Set publish catalogs to org/catalog (repeatable; replaces the allow list)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--remove <selector>",
    "Remove org/catalog from the plugin allow list (repeatable)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--clear", "Publish this plugin to all registered catalogs")
  .option("--account <name>", "Cloud account for auto-register")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Configure which registered catalogs a plugin publishes to")
  .action(async (plugin: string | undefined, opts: {
    add?: string[];
    remove?: string[];
    clear?: boolean;
    account?: string;
    format?: string;
    interactive?: boolean;
  }) => {
    try {
      await handlePluginCatalogBindingsCommand(plugin, {
        ...opts,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCatalogCmd
  .action(async () => {
    try {
      await handlePluginCatalogBindingsCommand(undefined, {
        interactive: true,
        format: "human",
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

pluginCmd
  .command("pull")
  .argument("<selector>", "Remote selector: org/catalog/plugin[@version], org/plugin[@version], or plugin[@version] with --org")
  .option("--as <name>", "Install under a different local plugin name")
  .option("--org <slug>", "Organization slug (when selector omits org)")
  .option("--catalog <slug>", "Catalog slug (default: default)")
  .option("--version <constraint>", "Version constraint (when selector omits version)")
  .option("--account <name>", "Cloud account to use")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Pull a plugin from the remote catalog into the local DB")
  .action(async (selector, opts) => {
    await handlePluginInstallCommand(selector, opts);
  });

const pluginPublishCmd = pluginCmd
  .command("publish")
  .description("Publish a local plugin to registered cloud catalogs");

pluginPublishCmd
  .command("plan")
  .argument("<plugin>", "Local plugin name")
  .option("--account <name>", "Cloud account to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Dry-run publish targets for a local plugin")
  .action(async (plugin: string, opts: { account?: string; format?: string }) => {
    await handlePluginPublishPlanCommand(plugin, opts);
  });

pluginPublishCmd
  .argument("<plugin>", "Local plugin name to publish")
  .argument("[target]", "One-off org/catalog target")
  .option("--org <slug>", "One-off organization slug")
  .option("--catalog <slug>", "One-off catalog slug (default: default)")
  .option("--version <semver>", "Cut the plugin to this semver before publishing")
  .option("--account <name>", "Cloud account to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((plugin: string, target: string | undefined, opts: {
    org?: string;
    catalog?: string;
    account?: string;
    format?: string;
    version?: string;
  }) => handlePluginPublishCommand(plugin, target, opts));

pluginCmd
  .command("cut")
  .argument("<plugin>", "Plugin name, name@version, or id")
  .requiredOption("--version <semver>", "New version (must differ from current)")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Cut a new local version from the working head")
  .action((plugin: string, opts: { version: string; format?: string }) => {
    handlePluginCutCommand(plugin, opts);
  });

pluginCmd
  .command("versions")
  .argument("<plugin>", "Plugin name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List local frozen versions and the working head")
  .action((plugin: string, opts: { format?: string }) => {
    handlePluginVersionsCommand(plugin, opts);
  });

pluginCmd
  .command("rollback")
  .argument("<plugin>", "Plugin name, name@version, or id")
  .requiredOption("--to <semver>", "Frozen version to copy onto the working head")
  .option("-y, --yes", "Skip the confirmation prompt")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Restore a frozen version onto the working head")
  .action(
    async (
      plugin: string,
      opts: { to: string; yes?: boolean; format?: string },
    ) => {
      await handlePluginRollbackCommand(plugin, opts);
    },
  );

pluginCmd
  .command("diff")
  .argument("<left>", "Plugin name or plugin export file")
  .argument("<right>", "Plugin name or plugin export file")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Diff two plugins or a plugin and a plugin export file")
  .action(handlePluginDiffCommand);

pluginCmd
  .command("doctor")
  .argument("[name]", "Plugin name or ID")
  .option("--check <name>", "Run only the named check", (value, previous: string[] = []) => [...previous, value], [])
  .option("--list-checks", "List available checks")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Run doctor checks against a plugin")
  .action(handlePluginDoctorCommand);

pluginCmd
  .command("check")
  .argument("[name]", "Plugin name; omit to check every syncable working head")
  .option("--refresh", "Force-fetch origins")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Compare library working heads to marketplace, git, and catalog origins")
  .action(async (name: string | undefined, opts: { refresh?: boolean; format?: string }) => {
    try {
      await handlePluginCheckCommand(name, opts);
    } catch (error) {
      process.exitCode = 1;
      renderCliError(error);
    }
  });

pluginCmd
  .command("update")
  .argument("[name]", "Plugin name")
  .option("--all", "Update every outdated syncable working head")
  .option("--force", "Reapply even when fingerprints match")
  .option("-y, --yes", "Skip confirmation for --all")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Update library working heads from marketplace, git, and catalog origins")
  .action(async (name: string | undefined, opts: {
    all?: boolean;
    force?: boolean;
    yes?: boolean;
    format?: string;
  }) => {
    try {
      await handlePluginUpdateCommand(name, opts);
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      process.exitCode = 1;
      renderCliError(error);
    }
  });

pluginCmd
  .command("why")
  .argument("<target>", "Plugin name, or a resource key like skill:deploy")
  .option("--project <path>", "Project directory", ".")
  .option("--root <plugin>", "Resolve against this root instead of the lockfile root")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Explain why a version was selected or which plugin won a resource")
  .action((target: string, opts: { project?: string; root?: string; format?: string }) => {
    handlePluginWhyCommand(target, opts);
  });

pluginCmd
  .command("fork")
  .argument("<plugin>", "Upstream or catalog plugin to fork")
  .option("--as <name>", "Name for the fork (default: <name>-fork)")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Create an editable authored copy of an upstream or catalog plugin")
  .action((selector: string, opts: { as?: string; format?: string }) => {
    handlePluginForkCommand(selector, opts);
  });

pluginCmd
  .command("from-project")
  .argument("[name]", "New plugin name")
  .option("--project <path>", "Project directory", ".")
  .option("-d, --description <text>", "Plugin description")
  .option("--harness <slug>", "Scan only a specific harness")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Scan current folder and create a plugin from its resources")
  .action(handlePluginFromProjectCommand);
}

/**
 * `ht layer …` keeps working for one release. It is hidden from help so the
 * surface reads as one concept, and every invocation names the new spelling.
 */
export function registerDeprecatedLayerAlias(root: Command): void {
  const alias = root
    .command("layer", { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description(false as unknown as string)
    .action(async (...args: unknown[]) => {
      ui.warn("ht layer is now ht plugin. The old spelling works for one release.");
      const command = args[args.length - 1] as Command;
      const raw = process.argv.slice(2);
      const layerIdx = raw.findIndex((arg) => arg === "layer");
      const rest = layerIdx >= 0 ? raw.slice(layerIdx + 1) : command.args;
      await root.parseAsync(["plugin", ...rest], { from: "user" });
    });
  alias.helpOption(false);
}
