import {
  getPluginById,
  getPluginResources,
  listPluginDependencies,
  listPlugins,
} from "../models/plugin-model.js";
import { listProjects } from "../models/project.js";
import { getLatestSnapshot } from "../models/snapshot.js";
import type { SnapshotState } from "../types.js";
import { setPluginResourceOverride } from "./plugin-overrides.js";
import {
  type ResolutionResult,
  resolutionKey,
  resolveComposition,
} from "./resolve/index.js";

export interface OrderMigrationReport {
  projectsWithSnapshot: number;
  projectsWithoutSnapshot: number;
  overridesWritten: Array<{ root: string; key: string; winner: string }>;
  warnings: string[];
}

export interface MigrateOrderToOverridesOptions {
  /** When true, report overrides that would be written without persisting them. */
  dryRun?: boolean;
}

/**
 * Reproduce previously applied results under nearest-to-root precedence.
 *
 * For every project with a recorded apply snapshot, compare the resource that
 * the old ordered merge materialized against the one resolution now picks. Where
 * they differ, write an explicit `overrides.resources` entry on the root so the
 * applied result is unchanged. Projects with no snapshot get a warning listing
 * the resources whose winner may change.
 */
export function migrateOrderToOverrides(
  options: MigrateOrderToOverridesOptions = {},
): OrderMigrationReport {
  const report: OrderMigrationReport = {
    projectsWithSnapshot: 0,
    projectsWithoutSnapshot: 0,
    overridesWritten: [],
    warnings: [],
  };
  const dryRun = options.dryRun === true;

  for (const project of listProjects()) {
    const snapshot = getLatestSnapshot(project.id);
    const state = snapshot?.state as SnapshotState | undefined;
    const rootPlugin = state?.plugins?.[state.plugins.length - 1];
    if (!rootPlugin) {
      report.projectsWithoutSnapshot += 1;
      continue;
    }
    report.projectsWithSnapshot += 1;

    let resolution: ResolutionResult;
    try {
      resolution = resolveComposition({ rootSelectors: [rootPlugin.name] });
    } catch {
      report.warnings.push(
        `${project.name}: ${rootPlugin.name} no longer resolves; run ` +
          `\`ht plugin apply ${rootPlugin.name} --explain\` to inspect.`,
      );
      continue;
    }

    const previousWinnerByKey = new Map<string, string>();
    for (const resource of state?.resources ?? []) {
      const owner = ownerPluginName(resource.id, resolution.selected);
      if (owner) {
        previousWinnerByKey.set(resolutionKey(resource), owner);
      }
    }

    for (const decision of resolution.decisions) {
      const previous = previousWinnerByKey.get(decision.key);
      if (!previous || previous === decision.winner.pluginName) continue;
      if (!dryRun) {
        setPluginResourceOverride(resolution.root.pluginId, decision.key, previous);
      }
      report.overridesWritten.push({
        root: resolution.root.name,
        key: decision.key,
        winner: previous,
      });
    }
  }

  // Projects with no snapshot: name the resources whose winner may change.
  if (report.projectsWithoutSnapshot > 0) {
    for (const project of listProjects()) {
      if (getLatestSnapshot(project.id)) continue;
      const contested = collectContestedKeys();
      if (contested.keys.length > 0) {
        report.warnings.push(
          `${project.name}: no apply snapshot recorded, so previous winners are unknown. ` +
            `Contested: ${contested.keys.join(", ")}. ` +
            `Run \`ht plugin apply ${contested.explainRoot} --explain\` to inspect.`,
        );
      } else {
        report.warnings.push(
          `${project.name}: no apply snapshot recorded, so previous winners are unknown.`,
        );
      }
    }
  }

  return report;
}

function collectContestedKeys(): { keys: string[]; explainRoot: string } {
  const keys: string[] = [];
  let explainRoot = "<root>";
  for (const plugin of listPlugins()) {
    if (listPluginDependencies(plugin.id).length === 0) continue;
    try {
      const resolution = resolveComposition({ rootSelectors: [plugin.name] });
      for (const decision of resolution.decisions) {
        if (decision.losers.length === 0) continue;
        if (!keys.includes(decision.key)) {
          keys.push(decision.key);
        }
      }
      if (explainRoot === "<root>") {
        explainRoot = plugin.name;
      }
    } catch {
      // Skip plugins that no longer resolve; the project-level warning still fires.
    }
  }
  return { keys, explainRoot };
}

function ownerPluginName(
  resourceId: string,
  selected: ReturnType<typeof resolveComposition>["selected"],
): string | undefined {
  for (const frame of selected) {
    const plugin = getPluginById(frame.pluginId);
    if (!plugin) continue;
    if (getPluginResources(plugin.id).some((resource) => resource.id === resourceId)) {
      return plugin.name;
    }
  }
  return undefined;
}
