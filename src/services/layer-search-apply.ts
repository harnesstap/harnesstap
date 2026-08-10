import { resolve } from "node:path";
import {
  applyToGlobal,
  type ConflictPolicy,
  type ConflictResolution,
  type MaterializationConflict,
} from "./applier.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { getLayerById } from "../models/layer-model.js";
import { listAttachedPluginPins } from "./layer-composition.js";
import {
  resolveApplyLayerSource,
  type ResolveApplyLayerSourceOptions,
} from "./layer-apply-source.js";
import { resolveEnvironmentCascadeForApply } from "./environment-cascade.js";
import { substituteResourcesForApply } from "./environment-var-substitution.js";
import { preparePluginPinsForApply } from "./plugin-pin-apply.js";
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
    throw new Error("No layers selected.");
  }
  return selections.map((selection) => selection.selector) as [string, ...string[]];
}

export async function promptCatalogSearchApplyScope(): Promise<CatalogSearchApplyScope> {
  return promptForChoice({
    message: "Where should selected layers be applied?",
    choices: [
      { name: "This project (current directory)", value: "project" },
      { name: "Global (user home — ~/.claude, ~/.codex, …)", value: "global" },
    ],
    default: "project",
  });
}

async function resolveMergedApplyBundle(
  selectors: [string, ...string[]],
  _projectRoot: string,
  options: ResolveApplyLayerSourceOptions,
) {
  const resolvedSources = await Promise.all(
    selectors.map((selector) => resolveApplyLayerSource(selector, options)),
  );
  const configuredLayerIds = resolvedSources.map((source) => {
    if (source.kind === "layer-export") {
      throw new Error("Layer export paths cannot be applied from catalog search.");
    }
    const layer = getLayerById(source.layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${source.layerId}`);
    }
    return layer.id;
  });
  return mergeLayersForApply(configuredLayerIds);
}

function mergedPluginPinsFromLayers(
  layerIds: string[],
): Array<{ ref: string; version_constraint: string }> {
  const pins = new Map<string, { ref: string; version_constraint: string }>();
  for (const layerId of layerIds) {
    for (const plugin of listAttachedPluginPins(layerId)) {
      pins.set(plugin.ref, {
        ref: plugin.ref,
        version_constraint: plugin.version_constraint,
      });
    }
  }
  return [...pins.values()];
}

export async function applyLayersGlobally(
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
  const merged = await resolveMergedApplyBundle(selectors, homeRoot, {
    account: options.account,
    baseUrl: options.baseUrl,
    onFetched: options.onFetched,
  });
  const configuredLayerIds = merged.layers.map((layer) => layer.id);
  const harnesses = resolveScanGlobalHarnessTargets(options.harness, homeRoot);
  const resolvedEnvironment = resolveEnvironmentCascadeForApply({
    configuredLayerIds,
  });
  const mergedPluginPins = mergedPluginPinsFromLayers(configuredLayerIds);

  const pluginPrepare = await preparePluginPinsForApply({
    pins: mergedPluginPins,
    baseResources: merged.resources,
    projectRoot: homeRoot,
    claudeConfig: merged.claude,
    scope: "user",
    skipSync: mergedPluginPins.length === 0,
  });

  let resolvedResources = merged.resources;
  if (
    mergedPluginPins.length > 0 &&
    pluginPrepare.installs.some((install) => install.status !== "already_installed")
  ) {
    const refreshed = await resolveMergedApplyBundle(selectors, homeRoot, {
      account: options.account,
      baseUrl: options.baseUrl,
      onFetched: options.onFetched,
    });
    resolvedResources = refreshed.resources;
  }

  const homeRootForClaude = resolveHomeRoot();
  const resolvedClaude =
    merged.claude?.plugins && merged.claude.plugins.length > 0
      ? {
          ...merged.claude,
          plugins: merged.claude.plugins.map((plugin) => ({
            ...plugin,
            id: resolveClaudeEnabledPluginRef(plugin.id, homeRootForClaude),
          })),
        }
      : merged.claude;

  const applyResources = substituteResourcesForApply(
    resolvedResources,
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
