import { resolve } from "node:path";
import {
  applyToGlobal,
  type ConflictPolicy,
  type ConflictResolution,
  type MaterializationConflict,
} from "./applier.js";
import { getPluginById, mergePluginsById } from "../models/plugin-model.js";
import {
  resolveApplyPluginSource,
  type ResolveApplyPluginSourceOptions,
} from "./plugin-apply-source.js";
import { resolveEnvironmentCascadeForApply } from "./environment-cascade.js";
import { substituteResourcesForApply } from "./environment-var-substitution.js";
import {
  collectPluginPinsForPrepare,
  preparePluginPinsForApply,
} from "./plugin-pin-apply.js";
import { resolveComposition } from "./resolve/index.js";
import { resolveScanGlobalHarnessTargets } from "./harness-targets.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { resolveClaudeEnabledPluginRef } from "../plugins/claude-plugin-ref.js";
import { promptForChoice } from "./wizards/shared.js";
import { ui } from "../ui/index.js";
import * as format from "../ui/format.js";
import type { InteractiveCatalogSearchSelection } from "./wizards/interactive-catalog-search.js";

export type CatalogSearchApplyScope = "global" | "project";

export function catalogSearchSelectors(
  selections: InteractiveCatalogSearchSelection[],
): [string, ...string[]] {
  if (selections.length === 0) {
    throw new Error("No plugins selected.");
  }
  return selections.map((selection) => selection.selector) as [string, ...string[]];
}

export async function promptCatalogSearchApplyScope(): Promise<CatalogSearchApplyScope> {
  return promptForChoice({
    message: "Where should selected plugins be applied?",
    choices: [
      { name: "This project (current directory)", value: "project" },
      { name: "Global (user home — ~/.claude, ~/.codex, …)", value: "global" },
    ],
    default: "project",
  });
}

async function resolveRootPluginsForSearchApply(
  selectors: [string, ...string[]],
  options: ResolveApplyPluginSourceOptions,
): Promise<{ rootPluginIds: string[]; rootSelectors: string[] }> {
  const resolvedSources = await Promise.all(
    selectors.map((selector) => resolveApplyPluginSource(selector, options)),
  );
  const rootPluginIds: string[] = [];
  const rootSelectors: string[] = [];
  for (const source of resolvedSources) {
    if (source.kind === "plugin-export") {
      throw new Error("Plugin export paths cannot be applied from catalog search.");
    }
    const plugin = getPluginById(source.pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${source.pluginId}`);
    }
    rootPluginIds.push(plugin.id);
    rootSelectors.push(`${plugin.name}@${plugin.version}`);
  }
  return { rootPluginIds, rootSelectors };
}

export async function applyPluginsGlobally(
  selectors: [string, ...string[]],
  options: {
    harness?: string;
    account?: string;
    baseUrl?: string;
    conflictPolicy: ConflictPolicy;
    conflictResolver?: (
      conflict: MaterializationConflict,
    ) => Promise<ConflictResolution> | ConflictResolution;
    onFetched?: (sourceLabel: string) => void;
  },
): Promise<{ cancelled: boolean }> {
  const homeRoot = resolveHomeRoot();
  const sourceOptions: ResolveApplyPluginSourceOptions = {
    account: options.account,
    baseUrl: options.baseUrl,
    onFetched: options.onFetched,
  };
  const { rootPluginIds, rootSelectors } = await resolveRootPluginsForSearchApply(
    selectors,
    sourceOptions,
  );

  const rootPluginPins = collectPluginPinsForPrepare(rootPluginIds);
  await preparePluginPinsForApply({
    pins: rootPluginPins,
    baseResources: [],
    projectRoot: homeRoot,
    claudeConfig: mergePluginsById(rootPluginIds).claude,
    scope: "user",
    skipSync: rootPluginPins.length === 0,
  });

  let resolution = resolveComposition({ rootSelectors });
  const configuredPluginIds = resolution.selected
    .filter((plugin) => !(plugin.depth === 0 && resolution.root.ephemeral))
    .map((plugin) => plugin.pluginId);

  const rootPinRefs = new Set(rootPluginPins.map((pin) => pin.ref));
  const additionalPins = collectPluginPinsForPrepare(configuredPluginIds).filter(
    (pin) => !rootPinRefs.has(pin.ref),
  );
  if (additionalPins.length > 0) {
    const additionalPrepare = await preparePluginPinsForApply({
      pins: additionalPins,
      baseResources: resolution.resources,
      projectRoot: homeRoot,
      claudeConfig: mergePluginsById(
        [...resolution.selected]
          .sort((a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex)
          .map((plugin) => plugin.pluginId),
      ).claude,
      scope: "user",
      skipSync: false,
    });
    if (
      additionalPrepare.installs.some(
        (install) => install.status !== "already_installed",
      )
    ) {
      resolution = resolveComposition({ rootSelectors });
    }
  }

  const harnesses = resolveScanGlobalHarnessTargets(options.harness, homeRoot);
  const resolvedEnvironment = resolveEnvironmentCascadeForApply({
    configuredPluginIds,
  });

  const mergedClaude = mergePluginsById(
    [...resolution.selected]
      .sort((a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex)
      .map((plugin) => plugin.pluginId),
  ).claude;

  const homeRootForClaude = resolveHomeRoot();
  const resolvedClaude =
    mergedClaude?.plugins && mergedClaude.plugins.length > 0
      ? {
          ...mergedClaude,
          plugins: mergedClaude.plugins.map((plugin) => ({
            ...plugin,
            id: resolveClaudeEnabledPluginRef(plugin.id, homeRootForClaude),
          })),
        }
      : mergedClaude;

  const applyResources = substituteResourcesForApply(
    resolution.resources,
    resolvedEnvironment.vars,
  ).resources;

  const applied = await applyToGlobal(applyResources, harnesses, homeRoot, {
    conflictPolicy: options.conflictPolicy,
    conflictResolver: options.conflictResolver,
    resolvedEnvironment,
    claudeConfig: resolvedClaude,
  });

  if (applied.cancelled) {
    return { cancelled: true };
  }

  ui.success(
    `Applied ${selectors.join(" + ")} globally (${format.formatCount(applied.writtenFiles.length, "file")})`,
  );

  return { cancelled: false };
}

export function resolveCatalogSearchProjectRoot(cwd = process.cwd()): string {
  return resolve(cwd);
}
