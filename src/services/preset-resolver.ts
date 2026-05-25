import type { Preset } from "../types.js";
import {
  getPreset,
  listPresetDependencies,
  parsePresetSelector,
} from "../models/preset.js";
import { satisfiesConstraint } from "./plugin-constraints.js";

export interface PresetResolutionResult {
  /** Topologically ordered list of resolved presets (dependencies before dependents). */
  resolved: Preset[];
  /** Maps each preset id to the ids of its direct dependencies. */
  dependencyMap: Record<string, string[]>;
}

/**
 * Resolve a set of root preset selectors into a fully-ordered dependency graph.
 *
 * - Highest compatible local version wins for each name.
 * - Cycles throw an error naming the presets involved.
 * - Missing compatible versions throw an error.
 * - Deduplicates presets that appear in multiple dependency paths.
 */
export function resolvePresetGraph(rootSelectors: string[]): PresetResolutionResult {
  // name → chosen Preset (for deduplication and cycle detection keyed by name)
  const resolved = new Map<string, Preset>();
  // names currently on the DFS recursion stack (for cycle detection)
  const visiting = new Set<string>();
  const order: Preset[] = [];
  const dependencyMap: Record<string, string[]> = {};

  function resolveByName(name: string, constraint: string | null, requestedBy: string): Preset {
    if (visiting.has(name)) {
      const path = [...visiting, name].join(" → ");
      throw new Error(`Preset dependency cycle detected: ${path}`);
    }
    if (resolved.has(name)) {
      const cached = resolved.get(name)!;
      if (constraint && !satisfiesConstraint(constraint, cached.version)) {
        throw new Error(
          `Preset "${name}" was resolved to version ${cached.version} but "${requestedBy}" requires "${constraint}" — conflicting constraints`,
        );
      }
      return cached;
    }

    visiting.add(name);

    const selector = constraint ? `${name}@${constraint}` : name;
    const preset = getPreset(selector);
    if (!preset) {
      throw new Error(
        `No compatible version found for preset "${name}"${constraint ? ` matching "${constraint}"` : ""} (required by "${requestedBy}")`,
      );
    }

    const deps = listPresetDependencies(preset.id);
    const depIds: string[] = [];

    for (const dep of deps) {
      const depPreset = resolveByName(dep.dependency_name, dep.version_constraint, name);
      depIds.push(depPreset.id);
    }

    visiting.delete(name);
    resolved.set(name, preset);
    dependencyMap[preset.id] = depIds;
    order.push(preset);

    return preset;
  }

  function resolveSelector(selector: string): void {
    const parsed = parsePresetSelector(selector);

    if (parsed.kind === "id") {
      // id-based lookup — if already resolved (by name), skip
      const preset = getPreset(selector);
      if (!preset) {
        throw new Error(`No preset found with id "${selector}"`);
      }
      // Use name for dedup tracking; if already resolved, verify it's the same preset
      if (resolved.has(preset.name)) {
        const cached = resolved.get(preset.name)!;
        if (cached.id !== preset.id) {
          throw new Error(
            `Preset "${preset.name}" was resolved to version ${cached.version} (id: ${cached.id}) but an explicit id selector "${selector}" targets version ${preset.version} (id: ${preset.id}) — conflicting selectors`,
          );
        }
        return;
      }

      visiting.add(preset.name);
      const deps = listPresetDependencies(preset.id);
      const depIds: string[] = [];
      for (const dep of deps) {
        const depPreset = resolveByName(dep.dependency_name, dep.version_constraint, preset.name);
        depIds.push(depPreset.id);
      }
      visiting.delete(preset.name);
      resolved.set(preset.name, preset);
      dependencyMap[preset.id] = depIds;
      order.push(preset);
      return;
    }

    if (parsed.kind === "name-version") {
      resolveByName(parsed.name, parsed.constraint, "<root>");
    } else {
      // kind === "name"
      resolveByName(parsed.name, null, "<root>");
    }
  }

  for (const selector of rootSelectors) {
    resolveSelector(selector);
  }

  return { resolved: order, dependencyMap };
}
