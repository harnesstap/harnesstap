import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  conflictingOptions,
  missingRequiredArg,
} from "../../services/cli-errors.js";
import { formatCount, formatLayerLabel } from "../formatting.js";
import { parseCommaSeparatedList } from "../handlers/parse-flags.js";
import { handleLayerInstallCommand } from "../handlers/layer-install.js";
import {
  handleLayerPublishCommand,
  handleLayerPublishPlanCommand,
} from "../handlers/layer-publish.js";
import { handleLayerShowCommand } from "../handlers/layer-show-command.js";
import { handleLayerWhyCommand } from "../handlers/layer-why.js";
import { resolveLayerMutationTarget } from "../handlers/resolve-layer-mutation-target.js";
import {
  isLayerAttachmentOnlyType,
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
import { detectPlatforms } from "../../services/scanner.js";
import {
  generateFiles,
  materializeFiles,
} from "../../services/applier.js";
import { inspectLayerExportFile } from "../../services/layer-export.js";
import { exportLayerDefinition } from "../../services/layer-editor.js";
import { importFromFile } from "../../services/layer-import.js";
import { openPathInSystemEditor } from "../../services/open-path.js";
import {
  createLayer,
  getLayer,
  listLayers,
  deleteLayer,
  getLayerById,
  resolveLayerSelector,
  mergeLayersById,
} from "../../models/layer-model.js";
import {
  upsertProject,
  getProjectByLocalPath,
  getProjectByOrigin,
  applyConfiguredLayerToProject,
} from "../../models/project.js";
import { createSnapshot } from "../../models/snapshot.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import type {
  ClaudeLayerConfig,
  ClaudePluginEntry,
  Layer,
  Resource,
  ResourceType,
  SnapshotState,
} from "../../types.js";
import { RESOURCE_TYPES } from "../../types.js";
import { listAttachedPluginPins } from "../../services/layer-composition.js";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
} from "../../models/harness.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  uniqueHarnessTargets,
} from "../../services/harness-targets.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import {
  handleLayerCatalogConnectLayerCommand,
  handleLayerCatalogConnectOrgCommand,
  handleLayerCatalogDisconnectLayerCommand,
  handleLayerCatalogDisconnectOrgCommand,
  handleLayerCatalogListCommand,
} from "../../services/layer-catalog.js";
import {
  handleLayerCatalogBindingsCommand,
  handleLayerCatalogRegisterCommand,
  handleLayerCatalogRegisteredCommand,
  handleLayerCatalogUnregisterCommand,
} from "../../services/layer-catalog-bindings.js";
import { resolveCatalogSearchProjectRoot } from "../../services/layer-search-apply.js";
import {
  configureLayerListInteractiveDeps,
  handleLayerListCommand,
} from "../../services/layer-list.js";
import {
  deleteCatalogLayer,
  editCatalogLayerComposition,
} from "../../services/catalog-layer-manage.js";
import {
  collectPluginPinsForPrepare,
  preparePluginPinsForApply,
  type SyncPluginPinsForApplyResult,
} from "../../services/plugin-pin-apply.js";
import { resolvePluginInstallScope, type InstallPluginPinResult } from "../../services/plugin-install.js";
import { resolveClaudeEnabledPluginRef } from "../../plugins/claude-plugin-ref.js";
import { diffLayers } from "../../services/layer-diff.js";
import {
  cutLayerVersion,
  LayerVersionError,
} from "../../services/layer-versioning.js";
import { listLayerDoctorChecks, runLayerDoctor } from "../../services/layer-doctor.js";
import { resolveComposition } from "../../services/resolve/index.js";
import type { ResolutionResult } from "../../services/resolve/types.js";
import {
  SingletonConflictError,
  UnsatisfiableConstraintError,
} from "../../services/resolve/types.js";
import { offerConflictScaffold } from "../../services/resolve-conflict-scaffold.js";
import { explainPayload, renderExplain } from "../../services/resolve/explain.js";
import {
  lockedVersionsFrom,
  lockfileFromResolution,
  lockIsUsable,
  readLockfile,
  writeLockfile,
} from "../../services/lockfile.js";
import { resolveEnvironmentCascadeForApply } from "../../services/environment-cascade.js";
import { substituteResourcesForApply } from "../../services/environment-var-substitution.js";
import { setLayerEnvironmentCommand, unsetLayerEnvironmentCommand } from "../../services/environment-commands.js";
import { createLayerFromProject } from "../../services/layer-from-project.js";
import { createLayerFromSource } from "../../services/layer-from-source.js";
import {
  resolveApplyLayerSource,
  type ResolveApplyLayerSourceOptions,
} from "../../services/layer-apply-source.js";
import { LayerAmbiguityError, LayerResolveError } from "../../services/layer-bare-name-resolve.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
import {
  addApplyCommandOptions,
  type ApplyCommandOpts,
} from "../../services/apply-command-options.js";
import {
  LAYER_ATTACHMENT_TYPES,
  LayerAttachmentHintError,
  validateLayerAttachmentType,
} from "../../services/layer-composition.js";
import { createProgress, type ProgressHandle } from "../../ui/progress.js";
import {
  isPromptCancellationError,
  promptForChoice,
  promptForValue,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import {
  applyLayerEdit,
  applyLayerEditScripting,
  attachmentKey,
  buildLayerEditCandidates,
  buildPendingFromApplySpec,
  parseLayerEditApplyFile,
} from "../../services/layer-edit.js";
import { runLayerEditWizard } from "../../services/wizards/layer-edit.js";
import { runLayerDeleteWizard } from "../../services/wizards/layer-delete.js";
import { runLayerFromProjectWizard } from "../../services/wizards/layer-from-project.js";
import { runLayerApplyWizard } from "../../services/wizards/layer-apply.js";
import { runLayerCreateFromSourceWizard } from "../../services/wizards/layer-create-from-source.js";
import {
  resolveSkillPackageCheckout,
  type LayerSourceConflictPolicy,
} from "../../services/skill-package-resolve.js";
async function deleteLocalLayerByName(nameOrId: string): Promise<void> {
  const layer = getLayer(nameOrId);
  if (!layer) {
    ui.danger(`Layer not found: ${nameOrId}`);
    return;
  }
  if (!deleteLayer(layer.id)) {
    ui.danger(`Failed to delete layer ${formatLayerLabel(layer)}`);
    return;
  }
  ui.success(`Deleted layer ${ui.theme.accent(formatLayerLabel(layer))}`);
}

async function resolveApplyRootSelectors(
  layerNames: [string, ...string[]],
  projectRoot: string,
  options: ResolveApplyLayerSourceOptions & {
    onFetched?: (sourceLabel: string) => void;
  } = {},
): Promise<{ selectors: string[]; rootLayerIds: string[] }> {
  const resolvedSources = await Promise.all(
    layerNames.map((selector) => resolveApplyLayerSource(selector, options)),
  );

  const selectors: string[] = [];
  const rootLayerIds: string[] = [];
  for (const source of resolvedSources) {
    if (source.kind === "layer-export") {
      if (resolvedSources.length > 1) {
        throw new Error(
          "Layer export paths and URLs cannot be mixed with layer selectors.",
        );
      }
      const summary = inspectLayerExportFile(source.path);
      const primary = summary.layers[summary.layers.length - 1];
      const existing = primary
        ? resolveLayerSelector(
            primary.version ? `${primary.name}@${primary.version}` : primary.name,
          )
        : undefined;
      if (existing) {
        selectors.push(`${existing.name}@${existing.version}`);
        rootLayerIds.push(existing.id);
      } else {
        const imported = importFromFile(source.path, {
          embeddedTargetDir: projectRoot,
        });
        const last = imported.layers[imported.layers.length - 1];
        if (!last) throw new Error("Bundle contains no layers.");
        selectors.push(`${last.layer.name}@${last.layer.version}`);
        rootLayerIds.push(last.layer.id);
      }
      continue;
    }
    const layer = getLayerById(source.layerId);
    if (!layer) throw new Error(`Layer not found: ${source.layerId}`);
    selectors.push(`${layer.name}@${layer.version}`);
    rootLayerIds.push(layer.id);
  }

  return { selectors, rootLayerIds };
}

async function resolveApplyLayers(
  layerNames: [string, ...string[]],
  projectRoot: string,
  options: ResolveApplyLayerSourceOptions & {
    onFetched?: (sourceLabel: string) => void;
    lockedVersions?: Map<string, string>;
  } = {},
): Promise<{
  layers: ReturnType<typeof getLayer>[];
  resources: Resource[];
  claude?: ClaudeLayerConfig;
  configuredLayerIds: string[];
  primaryConfiguredLayerId: string;
  resolution: ResolutionResult;
  rootLayerIds: string[];
}> {
  const { selectors, rootLayerIds } = await resolveApplyRootSelectors(
    layerNames,
    projectRoot,
    options,
  );

  const resolution = resolveComposition({
    rootSelectors: selectors,
    ...(options.lockedVersions ? { lockedVersions: options.lockedVersions } : {}),
  });

  const layers = resolution.selected
    .filter((plugin) => !(plugin.depth === 0 && resolution.root.ephemeral))
    .map((plugin) => getLayerById(plugin.layerId))
    .filter((layer): layer is NonNullable<typeof layer> => layer != null);

  const claude = mergeClaudeConfigsForResolution(resolution);
  const configuredLayerIds = layers.map((layer) => layer.id);

  return {
    layers,
    resources: resolution.resources,
    ...(claude ? { claude } : {}),
    configuredLayerIds,
    // Nearest-to-root already gives the root precedence; the "primary" is the
    // root itself, or the last argv selector when the root is ephemeral.
    primaryConfiguredLayerId: resolution.root.ephemeral
      ? (configuredLayerIds[configuredLayerIds.length - 1] ?? "")
      : resolution.root.layerId,
    resolution,
    rootLayerIds,
  };
}

/**
 * Claude marketplace/plugin config still merges the old way. Resolution
 * decides which layers participate; within that set, deeper layers are folded
 * in first so nearer ones win, matching Pass 2.
 */
function mergeClaudeConfigsForResolution(
  resolution: ResolutionResult,
): ClaudeLayerConfig | undefined {
  const ordered = [...resolution.selected].sort(
    (a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex,
  );
  const layerIds = ordered
    .map((plugin) => getLayerById(plugin.layerId))
    .filter((layer): layer is NonNullable<typeof layer> => layer != null)
    .map((layer) => layer.id);
  return mergeLayersById(layerIds).claude;
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


async function handleApplyCommand(
  layerNames: [string, ...string[]] | [],
  opts: ApplyCommandOpts,
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

  const outputFormat = parseOutputFormat(opts.format);

  const resolvedLayerNames = layerNames.length > 0
    ? layerNames
    : await (shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      })
        ? runLayerApplyWizard().then((layerName) => [layerName] as [string])
        : Promise.resolve([] as []));

  if (resolvedLayerNames.length === 0) {
    process.exitCode = 1;
    ui.danger(
      "Provide at least one layer name, layer export path, or URL.",
      {
        hints: [
          formatCommand("layer apply <layer>"),
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

  const projectRoot = resolve(opts.project);
  let applyBundle: Awaited<ReturnType<typeof resolveApplyLayers>>;
  const layerLabel = resolvedLayerNames.join(" + ");
  const resolveSpin = createProgress(`Resolving ${layerLabel}…`);
  const existingLock = opts.update ? undefined : readLockfile(projectRoot);
  const lockedVersions =
    existingLock && lockIsUsable(existingLock, resolvedLayerNames[0] ?? "")
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

  // Resolve argv selectors to concrete local layers without walking the graph,
  // so marketplace/git pins on those roots can be prepared first.
  let rootLayerIds: string[];
  try {
    ({ rootLayerIds } = await resolveApplyRootSelectors(
      resolvedLayerNames as [string, ...string[]],
      projectRoot,
      resolveSourceOptions,
    ));
  } catch (err) {
    resolveSpin.stop();
    process.exitCode = 1;
    if (err instanceof LayerResolveError || err instanceof LayerAmbiguityError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  const rootPluginPins = collectPluginPinsForPrepare(rootLayerIds);
  const skipPluginSync =
    opts.ignorePluginVersions || rootPluginPins.length === 0 || opts.dryRun;

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
    const rootClaude = mergeLayersById(rootLayerIds).claude;
    pluginPrepare = await preparePluginPinsForApply({
      pins: rootPluginPins,
      baseResources: [],
      projectRoot,
      claudeConfig: rootClaude,
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
    pluginValidationIssues = pluginPrepare.validationIssues;
  }

  const compositionSpin = skipPluginSync
    ? resolveSpin
    : createProgress(`Resolving ${layerLabel}…`);
  try {
    applyBundle = await resolveApplyLayers(
      resolvedLayerNames as [string, ...string[]],
      projectRoot,
      {
        ...resolveSourceOptions,
        ...(lockedVersions ? { lockedVersions } : {}),
      },
    );
  } catch (err) {
    compositionSpin.stop();
    process.exitCode = 1;
    if (
      err instanceof UnsatisfiableConstraintError ||
      err instanceof SingletonConflictError
    ) {
      ui.danger(err.message, { hints: err.hints });
      const scaffolded = await offerConflictScaffold({
        error: err,
        attemptedSelectors: resolvedLayerNames as string[],
        ...(opts.interactive !== undefined ? { interactive: opts.interactive } : {}),
        ...(opts.noInteractive !== undefined
          ? { noInteractive: opts.noInteractive }
          : {}),
        format: outputFormat,
      });
      if (scaffolded) {
        process.exitCode = 0;
        ui.success(`Created composition layer ${scaffolded}. Re-applying…`);
        await handleApplyCommand([scaffolded], opts);
        return;
      }
      return;
    }
    if (err instanceof LayerResolveError || err instanceof LayerAmbiguityError) {
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

  const primaryLayer =
    applyBundle.layers.find(
      (layer) => layer?.id === applyBundle.primaryConfiguredLayerId,
    ) ?? applyBundle.layers[0];
  if (!primaryLayer) {
    process.exitCode = 1;
    ui.danger("No layer resolved for apply");
    return;
  }

  let platforms: string[];
  try {
    platforms = resolveApplyHarnessTargets(
      projectRoot,
      opts.harness,
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  if (platforms.length === 0) {
    process.exitCode = 1;
    ui.warn(
      "No harness targets configured. Run harnesstap harness set or pass --harness <slugs>.",
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
    configuredLayerIds: applyBundle.configuredLayerIds,
  });
  const mergedPluginPins = (() => {
    const pins = new Map<string, { ref: string; version_constraint: string }>();
    for (const layer of applyBundle.layers) {
      if (!layer) continue;
      for (const plugin of listAttachedPluginPins(layer.id)) {
        pins.set(plugin.ref, {
          ref: plugin.ref,
          version_constraint: plugin.version_constraint,
        });
      }
    }
    return [...pins.values()];
  })();

  let applyResources = resources;

  // Prepare any marketplace/git pins discovered on non-root selected layers
  // after the first successful resolve (root pins were prepared above).
  const rootPinRefs = new Set(rootPluginPins.map((pin) => pin.ref));
  const additionalPins = collectPluginPinsForPrepare(
    applyBundle.configuredLayerIds,
  ).filter((pin) => !rootPinRefs.has(pin.ref));
  const shouldPrepareAdditional =
    !opts.ignorePluginVersions &&
    !opts.dryRun &&
    additionalPins.length > 0;

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
        applyBundle = await resolveApplyLayers(
          resolvedLayerNames as [string, ...string[]],
          projectRoot,
          {
            account: opts.account,
            baseUrl: opts.baseUrl,
            interactive: opts.interactive,
            noInteractive: opts.noInteractive,
            format: outputFormat,
            ...(lockedVersions ? { lockedVersions } : {}),
          },
        );
        resources = applyBundle.resources;
        claude = applyBundle.claude;
        applyResources = resources;
      } catch (err) {
        process.exitCode = 1;
        if (
          err instanceof UnsatisfiableConstraintError ||
          err instanceof SingletonConflictError
        ) {
          ui.danger(err.message, { hints: err.hints });
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
        ...(projectHarnessConfig?.cursor_skill_mode
          ? { skillCursorMode: projectHarnessConfig.cursor_skill_mode }
          : {}),
      },
    );
  } finally {
    generateSpin.stop();
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

  // Ephemeral multi-selector roots (`ht layer apply a b`) use a synthetic
  // `__ht_ephemeral_root__…` name that is never reusable via lockIsUsable —
  // writing that lock would poison checked-in locks. Durable single-root
  // applies still record the resolved plugin set.
  if (!opts.dryRun && !applyBundle.resolution.root.ephemeral) {
    writeLockfile(projectRoot, lockfileFromResolution(applyBundle.resolution));
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
      layers: applyBundle.layers.filter((p): p is NonNullable<typeof p> => p != null),
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
        resolvedLayerNames.length > 1
          ? `Before applying: ${resolvedLayerNames.join(" + ")}`
          : `Before applying: ${primaryLayer.name}`,
      state: snapshotState,
    });

    applyConfiguredLayerToProject({
      project_id: project.id,
      configured_layer_id: applyBundle.primaryConfiguredLayerId,
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
        layer: primaryLayer.name,
        layers: resolvedLayerNames,
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


function shouldUseInteractiveLayerEdit(input: {
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

function printLayerEditJsonSnapshot(layer: Layer, rows: ReturnType<typeof buildLayerEditCandidates>): void {
  printJson({
    layer: {
      id: layer.id,
      name: layer.name,
      version: layer.version,
    },
    attachments: rows
      .filter((row) => row.checked)
      .map((row) => ({
        key: attachmentKey(row),
        type: row.type,
        id: row.id.startsWith("layer-candidate:") ? null : row.id,
        version_constraint: row.version_constraint ?? null,
      })),
  });
}

async function handleLayerEditCommand(
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
  const scripting = adds.length > 0
    || removes.length > 0
    || Boolean(opts.apply)
    || Boolean(environmentChange);

  if (opts.environment && opts.clearEnvironment) {
    process.exitCode = 1;
    renderCliError(conflictingOptions("--environment", "--clear-environment"));
    return;
  }

  let typeFilter: ResourceType | undefined;
  if (scripting) {
    if (opts.type) {
      try {
        validateLayerAttachmentType(opts.type);
      } catch (error) {
        process.exitCode = 1;
        ui.danger(error instanceof Error ? error.message : String(error));
        return;
      }
    }
  } else if (isLayerAttachmentOnlyType(opts.type)) {
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
    : name ?? await resolveLayerMutationTarget({
        layerName: name,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which layer do you want to edit?",
      });

  if (!resolvedName) {
    process.exitCode = 1;
    ui.danger(
      scripting || listLayers().length > 0
        ? "error: missing required argument 'name'"
        : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
    );
    return;
  }

  const layer = getLayer(resolvedName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${resolvedName}`);
    return;
  }

  const candidates = buildLayerEditCandidates(layer);

  if (scripting) {
    try {
      if (environmentChange) {
        if (opts.dryRun) {
          const action = environmentChange.kind === "set"
            ? `set default environment to ${environmentChange.environment}`
            : "clear default environment";
          ui.info(`Would ${action} on ${formatLayerLabel(layer)}`);
        } else if (environmentChange.kind === "set") {
          const result = setLayerEnvironmentCommand(resolvedName, environmentChange.environment);
          if (format === "json") {
            printJson(result);
          } else {
            ui.success(
              `Set default environment on ${ui.theme.accent(formatLayerLabel(layer))}`,
            );
          }
        } else {
          const result = unsetLayerEnvironmentCommand(resolvedName);
          if (format === "json") {
            printJson(result);
          } else {
            ui.success(
              `Cleared default environment on ${ui.theme.accent(formatLayerLabel(layer))}`,
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
        const attachments = parseLayerEditApplyFile(raw);
        const pending = buildPendingFromApplySpec(candidates, attachments);
        const result = await applyLayerEdit({
          layer,
          initial: candidates,
          pending,
          dryRun: opts.dryRun,
        });
        printLayerEditSuccess(layer, result, opts.dryRun);
        return;
      }

      const attachmentType = validateLayerAttachmentType(opts.type);
      const result = await applyLayerEditScripting({
        layer,
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
        printLayerEditSuccess(layer, result, true);
        return;
      }

      for (const message of result.messages) {
        ui.success(ui.theme.accent(message));
      }
      return;
    } catch (error) {
      if (error instanceof LayerAttachmentHintError) {
        process.exitCode = 1;
        ui.danger(error.message, { hints: error.hints });
        return;
      }
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  if (format === "json" && !shouldUseInteractiveLayerEdit(opts)) {
    printLayerEditJsonSnapshot(layer, candidates);
    return;
  }

  if (!shouldUseInteractiveLayerEdit(opts)) {
    process.exitCode = 1;
    ui.danger(
      `layer edit requires an interactive terminal, or use \`${formatCommand("layer edit <name> --add <selector> --type <type>")}\`, \`--remove\`, \`--apply <file>\`, \`--environment <name>\`, or \`--clear-environment\` for scripting.`,
    );
    return;
  }

  try {
    const pending = await runLayerEditWizard({
      layer,
      typeFilter,
      search: opts.search,
      showId: opts.showId,
      showAll: opts.all,
    });
    if (!pending) {
      process.exitCode = 1;
      return;
    }

    const result = await applyLayerEdit({
      layer,
      initial: candidates,
      pending,
      dryRun: opts.dryRun,
    });
    printLayerEditSuccess(layer, result, opts.dryRun);
  } catch (error) {
    if (isPromptCancellationError(error)) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function printLayerEditSuccess(
  layer: Layer,
  result: { added: string[]; removed: string[] },
  dryRun?: boolean,
): void {
  const label = formatLayerLabel(layer);
  const summary = `+${result.added.length} added, −${result.removed.length} removed`;
  if (dryRun) {
    ui.success(`Dry run for layer ${ui.theme.accent(label)} ${ui.icons.bullet} ${summary} (no changes written)`);
    return;
  }
  ui.success(`Updated layer ${ui.theme.accent(label)} ${ui.icons.bullet} ${summary}`);
}

async function handleLayerEditorCommand(
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

  const resolvedName = name ?? await resolveLayerMutationTarget({
    layerName: name,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    message: "Which layer definition do you want to open?",
  });
  if (!resolvedName) {
    process.exitCode = 1;
    ui.danger(
      listLayers().length > 0
        ? "error: missing required argument 'name'"
        : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
    );
    return;
  }

  const layer = getLayer(resolvedName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${resolvedName}`);
    return;
  }

  try {
    const definitionPath = exportLayerDefinition(layer);
    if (format === "json") {
      printJson({
        layer: formatLayerLabel(layer),
        path: definitionPath,
      });
      return;
    }

    openPathInSystemEditor(definitionPath);
    ui.success(`Opened layer definition ${ui.theme.accent(definitionPath)}`);
    ui.info(
      `After editing, import changes with \`${formatCommand(`migrate import ${definitionPath}`)}\`.`,
    );
  } catch (error) {
    process.exitCode = 1;
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

function resolveApplyHarnessTargets(
  projectRoot: string,
  harnessOption?: string,
): string[] {
  const explicitTargets = uniqueHarnessTargets(
    parsePlatformFilter(harnessOption) ?? [],
  );
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const projectByPath = getProjectByLocalPath(projectRoot);
  const projectConfig = projectByPath
    ? getProjectHarnessConfig(projectByPath.id)
    : undefined;
  if (projectConfig) {
    const preferredTargets = uniqueHarnessTargets([
      projectConfig.main_harness,
      ...projectConfig.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  const preference = getHarnessPreference();
  if (preference) {
    const preferredTargets = uniqueHarnessTargets([
      preference.main_harness,
      ...preference.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  return uniqueHarnessTargets(detectPlatforms(projectRoot));
}


function parseLayerSourceConflictPolicy(
  value: string | undefined,
): LayerSourceConflictPolicy | undefined {
  if (!value) return undefined;
  if (value === "cancel" || value === "merge" || value === "overwrite") {
    return value;
  }
  throw new Error(
    `Invalid --on-conflict value: ${value}. Use cancel, merge, or overwrite.`,
  );
}

function handleLayerCutCommand(
  layerSelector: string,
  opts: { version: string; format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  const layer = getLayer(layerSelector);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${layerSelector}`);
    return;
  }

  try {
    const cut = cutLayerVersion({ layerId: layer.id, newVersion: opts.version });
    if (format === "json") {
      printJson(cut);
      return;
    }
    ui.success(`Cut layer ${ui.theme.accent(formatLayerLabel(cut))}`);
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof LayerVersionError) {
      ui.danger(err.message);
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

function handleLayerDiffCommand(
  left: string,
  right: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    const report = diffLayers(left, right);
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
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleLayerDoctorCommand(
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
      const checks = listLayerDoctorChecks().map((check) => ({
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

    const resolvedName = name ?? await resolveLayerMutationTarget({
      layerName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which layer do you want to diagnose?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger(
        listLayers().length > 0
          ? "error: missing required argument 'name'"
          : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
      );
      return;
    }

    const report = runLayerDoctor({
      nameOrId: resolvedName,
      checkIds: opts.check,
    });

    if (format === "json") {
      printJson(report);
      if (!report.valid) process.exitCode = 1;
      return;
    }

    // Human format: show all checks with pass/fail markers
    const allChecks = listLayerDoctorChecks().filter((check) => 
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
      summary: report.valid ? `${report.layer}: valid` : `${report.layer}: invalid`,
    });
    if (!report.valid) {
      process.exitCode = 1;
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handleLayerFromProjectCommand(
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
      ? runLayerFromProjectWizard()
      : Promise.resolve(undefined));

    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger("error: missing required argument 'name'");
      return;
    }

    const projectRoot = resolve(opts.project);

    // First, preview what would happen
    const { previewLayerFromProject } = await import("../../services/layer-from-project.js");
    const preview = await previewLayerFromProject({
      name: resolvedName,
      projectRoot,
      platform: opts.harness,
    });

    // If layer exists and has conflicts, prompt for resolution
    if (preview.layerExists && (preview.conflicts.length > 0 || preview.newResources.length > 0)) {
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
        ui.danger(`Layer "${resolvedName}" already exists with ${parts.join(" and ")}. Use --interactive to resolve conflicts.`);
        return;
      }

      // Show preview
      ui.info(`\nLayer "${resolvedName}" already exists.`);
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
          message: "Enter new layer name",
          default: `${resolvedName}-copy`,
        });

        const result = await createLayerFromProject({
          name: newName,
          description: opts.description,
          projectRoot,
          platform: opts.harness,
        });

        ui.success(
          `Created layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }

      if (action === "overwrite") {
        const result = await createLayerFromProject({
          name: resolvedName,
          description: opts.description,
          projectRoot,
          platform: opts.harness,
          conflictStrategy: "overwrite",
        });

        ui.success(
          `Updated layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }
    }

    // No conflicts or layer doesn't exist - proceed normally
    const result = await createLayerFromProject({
      name: resolvedName,
      description: opts.description,
      projectRoot,
      platform: opts.harness,
    });

    ui.success(
      `Created layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleLayerCreateCommand(
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
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const db = getDb();
  initializeSchema(db);
  const tags = opts.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [];
  const version = opts.version ?? "1.0.0";

  if (!opts.from) {
    const layer = createLayer({
      name,
      version,
      description: opts.description,
      tags,
    });
    if (format === "json") {
      printJson(layer);
      return;
    }
    ui.success(`Created layer ${ui.theme.accent(formatLayerLabel(layer))}`);
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
  const onConflictFlag = parseLayerSourceConflictPolicy(opts.onConflict);
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

  const wizard = await runLayerCreateFromSourceWizard({
    layerName: name,
    layerVersion: version,
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

  const result = await createLayerFromSource({
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
    layer: result.layer.name,
    version: result.layer.version,
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
      `Dry run ${ui.icons.hint} would configure layer ${ui.theme.accent(formatLayerLabel(result.layer))} with ${formatCount(result.attachedSkills.length, "skill")} from ${result.namespace}`,
    );
    return;
  }

  const actionLabel = result.conflictPolicy === "merge"
    ? "Updated"
    : result.conflictPolicy === "overwrite"
      ? "Replaced"
      : "Created";
  ui.success(
    `${actionLabel} layer ${ui.theme.accent(formatLayerLabel(result.layer))} ${ui.icons.bullet} ${formatCount(result.attachedSkills.length, "skill")} attached from ${result.namespace}`,
  );
  console.log("");
  ui.kvBlock([
    { key: "Attached", value: result.attachedSkills.join(", ") || "—" },
    ...(result.installedSkills.length > 0
      ? [{ key: "Installed", value: result.installedSkills.join(", ") }]
      : []),
    { key: "Run", value: formatCommand(`layer show ${result.layer.name}`) },
  ]);
}

configureLayerListInteractiveDeps({
  applyToProject: async (selectors, applyOpts) => {
    await handleApplyCommand(selectors, {
      project: resolveCatalogSearchProjectRoot(),
      account: applyOpts.account,
      baseUrl: applyOpts.baseUrl,
      format: applyOpts.format,
      noInteractive: applyOpts.noInteractive,
    });
  },
  onInstall: async (selector, installOpts) => {
    await handleLayerInstallCommand(selector, {
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
    await handleLayerEditCommand(name, {
      format: editOpts.format,
      interactive: true,
    });
  },
  onDelete: async (name, _deleteOpts) => {
    await deleteLocalLayerByName(name);
  },
  onEditRemote: async (catalogLayer, selection, remoteOpts) => {
    try {
      await editCatalogLayerComposition(catalogLayer, selection, {
        account: remoteOpts.account,
        baseUrl: remoteOpts.baseUrl,
        onEditLocal: async (name) => {
          await handleLayerEditCommand(name, {
            format: remoteOpts.format,
            interactive: true,
          });
        },
        onPublish: async (layerName, catalogSelector, publishOpts) => {
          await handleLayerPublishCommand(layerName, catalogSelector, {
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
  onDeleteRemote: async (catalogLayer, remoteOpts) => {
    try {
      await deleteCatalogLayer(catalogLayer, {
        account: remoteOpts.account,
        baseUrl: remoteOpts.baseUrl,
      });
    } catch (err) {
      process.exitCode = 1;
      renderCliError(err);
    }
  },
});


export function registerLayerCommands(root: Command): void {
  const layerCmd = configureCommandGroup(
  root
    .command("layer")
    .alias("l")
    .description("Manage layers (named bundles of resources that can be applied to a project)"),
);

layerCmd
  .command("create")
  .argument("<name>", "Layer name")
  .option("-d, --description <text>", "Layer description")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--version <semver>", "Layer version (semver)", "1.0.0")
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
    "When layer exists: cancel, merge, or overwrite (default: cancel)",
  )
  .option("--install", "Install selected skills to hub paths")
  .option("--global", "Install globally when --install is set")
  .option("--project [path]", "Install to project when --install is set")
  .option("--harness <slugs>", "Comma-separated harness slugs for --install")
  .option("--method <mode>", "Install method when --install is set: symlink or copy")
  .option("--dry-run", "Preview layer configuration without writing")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("-y, --yes", "Skip interactive prompts")
  .description("Create a layer from scratch, a skill package, or a scan")
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
      },
    ) => {
      try {
        await handleLayerCreateCommand(name, opts);
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

layerCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in human-readable tables")
  .option("-s, --search <query>", "Filter by name, description, or tags (local and remote)")
  .option("--local-only", "List only local layers")
  .option("--remote-only", "List only remote catalog layers")
  .option("--tag <tag>", "Filter remote catalog layers by tag")
  .option("--account <name>", "Cloud account to use for remote listing")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--no-interactive", "Disable interactive wizards")
  .option("--interactive", "Enable interactive wizards")
  .description("List local layers and optionally search the remote catalog")
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
      await handleLayerListCommand({
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

layerCmd
  .command("show")
  .argument("[name]", "Layer name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .description("Show layer details, resources, and plugin pins")
  .action(async (name: string | undefined, opts: { format?: string; showId?: boolean; interactive?: boolean; noInteractive?: boolean }) => {
    const resolvedName = name ?? await resolveLayerMutationTarget({
      layerName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which layer do you want to show?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      if (listLayers().length > 0) {
        renderCliError(missingRequiredArg("name", "layer show"));
      } else {
        ui.danger(`No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`);
      }
      return;
    }
    handleLayerShowCommand(resolvedName, opts);
  });

layerCmd
  .command("edit")
  .argument("[name]", "Layer name or ID")
  .option("-t, --type <type>", `Attachment or filter type (${LAYER_ATTACHMENT_TYPES.join(", ")})`)
  .option("-s, --search <query>", "Pre-fill search filter (interactive mode)")
  .option("--show-id", "Show IDs in tables")
  .option("--all", "Show all resources per type (default: first 10 per type)")
  .option("--add <selector>", "Add attachment (repeatable; scripting mode)", collectRepeatedOption, [])
  .option("--remove <selector>", "Remove attachment (repeatable; scripting mode)", collectRepeatedOption, [])
  .option("--apply <file>", "Apply membership from JSON file (scripting mode)")
  .option("--version <constraint>", "Version constraint for plugin or layer attachments")
  .option("--embed", "Mark plugin pin as embed-on-export when adding")
  .option("--sync", "Sync plugin resource immediately after add")
  .option("--environment <name>", "Set default environment for layer apply cascade")
  .option("--clear-environment", "Clear default environment from layer")
  .option("--dry-run", "Preview changes without writing")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Edit layer composition and default environment (interactive or scripting)")
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
    dryRun?: boolean;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  }) => {
    try {
      await handleLayerEditCommand(name, opts);
    } catch (error) {
      process.exitCode = 1;
      if (error instanceof LayerAttachmentHintError) {
        ui.danger(error.message, { hints: error.hints });
        return;
      }
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCmd
  .command("editor")
  .argument("[name]", "Layer name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Open a layer definition file in your system editor")
  .action(async (name: string | undefined, opts: {
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  }) => {
    await handleLayerEditorCommand(name, opts);
  });

layerCmd
  .command("delete")
  .argument("[name]", "Layer name, name@version selector, or ID")
  .option("-s, --search <query>", "Filter layers in the delete wizard")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Delete a local layer and its composition attachments")
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
          ? await runLayerDeleteWizard({ search: opts.search })
          : [];

      if (selectors.length === 0) {
        throw !name && useWizard
          ? new Error("No layers selected for deletion")
          : missingRequiredArg("name", "layer delete");
      }

      for (const resolvedName of selectors) {
        const layer = getLayer(resolvedName);
        if (!layer) {
          process.exitCode = 1;
          ui.danger(`Layer not found: ${resolvedName}`);
          return;
        }
        if (!deleteLayer(layer.id)) {
          throw new Error(`Failed to delete layer ${formatLayerLabel(layer)}`);
        }
        ui.success(`Deleted layer ${ui.theme.accent(formatLayerLabel(layer))}`);
      }
    } catch (err) {
      process.exitCode = 1;
      renderCliError(err);
    }
  });

addApplyCommandOptions(
  layerCmd
    .command("apply")
    .argument(
      "[layers...]",
      "Layer name(s), layer export path, or URL (multiple roots become an ephemeral composition)",
    )
    .description(
      "Apply one or more layers (or a layer export URL) to a project, serializing for each harness",
    ),
).action(async (layers: string[], opts: ApplyCommandOpts) => {
  await handleApplyCommand(layers as [string, ...string[]] | [], opts);
});

const layerCatalogCmd = layerCmd
  .command("catalog")
  .description("Manage publish catalog bindings and connected pull sources");

layerCatalogCmd
  .command("list")
  .alias("ls")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show default and connected catalog sources")
  .action(async (opts: { baseUrl?: string; format?: string }) => {
    try {
      await handleLayerCatalogListCommand({
        baseUrl: opts.baseUrl,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("connect")
  .argument("<target>", "org <slug> or layer <org/catalog/layer>")
  .argument("[value]", "Organization slug or org/catalog/layer selector")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .description("Connect an org or individual public layer to the local catalog scope")
  .action(async (target: string, value: string | undefined, opts: { baseUrl?: string }) => {
    try {
      if (target === "org") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'slug' for org connect");
          return;
        }
        await handleLayerCatalogConnectOrgCommand(value, opts);
        return;
      }
      if (target === "layer") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/catalog/layer' for layer connect");
          return;
        }
        await handleLayerCatalogConnectLayerCommand(value, opts);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'layer'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("disconnect")
  .argument("<target>", "org <slug> or layer <org/catalog/layer>")
  .argument("[value]", "Organization slug or org/catalog/layer selector")
  .description("Disconnect a connected org or layer from the local catalog scope")
  .action(async (target: string, value: string | undefined) => {
    try {
      if (target === "org") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'slug' for org disconnect");
          return;
        }
        await handleLayerCatalogDisconnectOrgCommand(value);
        return;
      }
      if (target === "layer") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/catalog/layer' for layer disconnect");
          return;
        }
        await handleLayerCatalogDisconnectLayerCommand(value);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'layer'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("register")
  .argument("<selector>", "Publish catalog org/catalog or account@org/catalog")
  .option("--account <name>", "Cloud account for this catalog")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Register a publish catalog on this machine")
  .action(async (selector: string, opts: { account?: string; format?: string }) => {
    try {
      await handleLayerCatalogRegisterCommand(selector, {
        account: opts.account,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("unregister")
  .argument("<selector>", "Publish catalog org/catalog")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Remove a publish catalog from this machine")
  .action(async (selector: string, opts: { format?: string }) => {
    try {
      await handleLayerCatalogUnregisterCommand(selector, {
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("registered")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List registered publish catalogs")
  .action(async (opts: { format?: string }) => {
    try {
      await handleLayerCatalogRegisteredCommand({
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("bindings [layer]")
  .option(
    "--add <selector>",
    "Set publish catalogs to org/catalog (repeatable; replaces the allow list)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--remove <selector>",
    "Remove org/catalog from the layer allow list (repeatable)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--clear", "Publish this layer to all registered catalogs")
  .option("--account <name>", "Cloud account for auto-register")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Configure which registered catalogs a layer publishes to")
  .action(async (layer: string | undefined, opts: {
    add?: string[];
    remove?: string[];
    clear?: boolean;
    account?: string;
    format?: string;
    interactive?: boolean;
  }) => {
    try {
      await handleLayerCatalogBindingsCommand(layer, {
        ...opts,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .action(async () => {
    try {
      await handleLayerCatalogBindingsCommand(undefined, {
        interactive: true,
        format: "human",
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCmd
  .command("pull")
  .argument("<selector>", "Remote selector: org/catalog/layer[@version], org/layer[@version], or layer[@version] with --org")
  .option("--as <name>", "Install under a different local layer name")
  .option("--org <slug>", "Organization slug (when selector omits org)")
  .option("--catalog <slug>", "Catalog slug (default: default)")
  .option("--version <constraint>", "Version constraint (when selector omits version)")
  .option("--account <name>", "Cloud account to use")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Pull a layer from the remote catalog into the local DB")
  .action(async (selector, opts) => {
    await handleLayerInstallCommand(selector, opts);
  });

const layerPublishCmd = layerCmd
  .command("publish")
  .description("Publish a local layer to registered cloud catalogs");

layerPublishCmd
  .command("plan")
  .argument("<layer>", "Local layer name")
  .option("--account <name>", "Cloud account to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Dry-run publish targets for a local layer")
  .action(async (layer: string, opts: { account?: string; format?: string }) => {
    await handleLayerPublishPlanCommand(layer, opts);
  });

layerPublishCmd
  .argument("<layer>", "Local layer name to publish")
  .argument("[target]", "One-off org/catalog target")
  .option("--org <slug>", "One-off organization slug")
  .option("--catalog <slug>", "One-off catalog slug (default: default)")
  .option("--version <semver>", "Cut the layer to this semver before publishing")
  .option("--account <name>", "Cloud account to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((layer: string, target: string | undefined, opts: {
    org?: string;
    catalog?: string;
    account?: string;
    format?: string;
    version?: string;
  }) => handleLayerPublishCommand(layer, target, opts));

layerCmd
  .command("cut")
  .argument("<layer>", "Layer name, name@version, or id")
  .requiredOption("--version <semver>", "New version (must differ from current)")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Cut a new local version from the working head")
  .action((layer: string, opts: { version: string; format?: string }) => {
    handleLayerCutCommand(layer, opts);
  });

layerCmd
  .command("diff")
  .argument("<left>", "Layer name or layer export file")
  .argument("<right>", "Layer name or layer export file")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Diff two layers or a layer and a layer export file")
  .action(handleLayerDiffCommand);

layerCmd
  .command("doctor")
  .argument("[name]", "Layer name or ID")
  .option("--check <name>", "Run only the named check", (value, previous: string[] = []) => [...previous, value], [])
  .option("--list-checks", "List available checks")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Run doctor checks against a layer")
  .action(handleLayerDoctorCommand);

layerCmd
  .command("why")
  .argument("<target>", "Layer name, or a resource key like skill:deploy")
  .option("--project <path>", "Project directory", ".")
  .option("--root <layer>", "Resolve against this root instead of the lockfile root")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Explain why a version was selected or which layer won a resource")
  .action((target: string, opts: { project?: string; root?: string; format?: string }) => {
    handleLayerWhyCommand(target, opts);
  });

layerCmd
  .command("from-project")
  .argument("[name]", "New layer name")
  .option("--project <path>", "Project directory", ".")
  .option("-d, --description <text>", "Layer description")
  .option("--harness <slug>", "Scan only a specific harness")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Scan current folder and create a layer from its resources")
  .action(handleLayerFromProjectCommand);
}
