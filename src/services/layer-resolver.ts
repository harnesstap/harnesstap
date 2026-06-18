import type { Layer } from "../types.js";
import {
  getLayer,
  listLayerDependencies,
  parseLayerSelectorString,
} from "../models/layer-model.js";
import { satisfiesConstraint } from "./plugin-constraints.js";

export interface LayerResolutionResult {
  /** Topologically ordered list of resolved layers (dependencies before dependents). */
  resolved: Layer[];
  /** Maps each layer id to the ids of its direct dependencies. */
  dependencyMap: Record<string, string[]>;
}

/**
 * Resolve a set of root layer selectors into a fully-ordered dependency graph.
 *
 * - Highest compatible local version wins for each name.
 * - Cycles throw an error naming the layers involved.
 * - Missing compatible versions throw an error.
 * - Deduplicates layers that appear in multiple dependency paths.
 */
export function resolveLayerGraph(rootSelectors: string[]): LayerResolutionResult {
  // name → chosen Layer (for deduplication and cycle detection keyed by name)
  const resolved = new Map<string, Layer>();
  // names currently on the DFS recursion stack (for cycle detection)
  const visiting = new Set<string>();
  const order: Layer[] = [];
  const dependencyMap: Record<string, string[]> = {};

  function resolveByName(name: string, constraint: string | null, requestedBy: string): Layer {
    if (visiting.has(name)) {
      const path = [...visiting, name].join(" → ");
      throw new Error(`Layer dependency cycle detected: ${path}`);
    }
    const cached = resolved.get(name);
    if (cached) {
      if (constraint && !satisfiesConstraint(constraint, cached.version)) {
        throw new Error(
          `Layer "${name}" was resolved to version ${cached.version} but "${requestedBy}" requires "${constraint}" — conflicting constraints`,
        );
      }
      return cached;
    }

    visiting.add(name);

    const selector = constraint ? `${name}@${constraint}` : name;
    const layer = getLayer(selector);
    if (!layer) {
      throw new Error(
        `No compatible version found for layer "${name}"${constraint ? ` matching "${constraint}"` : ""} (required by "${requestedBy}")`,
      );
    }

    const deps = listLayerDependencies(layer.id);
    const depIds: string[] = [];

    for (const dep of deps) {
      const depLayer = resolveByName(dep.dependency_name, dep.version_constraint, name);
      depIds.push(depLayer.id);
    }

    visiting.delete(name);
    resolved.set(name, layer);
    dependencyMap[layer.id] = depIds;
    order.push(layer);

    return layer;
  }

  function resolveSelector(selector: string): void {
    const parsed = parseLayerSelectorString(selector);

    if (parsed.kind === "id") {
      // id-based lookup — if already resolved (by name), skip
      const layer = getLayer(selector);
      if (!layer) {
        throw new Error(`No layer found with id "${selector}"`);
      }
      // Use name for dedup tracking; if already resolved, verify it's the same layer
      const cached = resolved.get(layer.name);
      if (cached) {
        if (cached.id !== layer.id) {
          throw new Error(
            `Layer "${layer.name}" was resolved to version ${cached.version} (id: ${cached.id}) but an explicit id selector "${selector}" targets version ${layer.version} (id: ${layer.id}) — conflicting selectors`,
          );
        }
        return;
      }

      visiting.add(layer.name);
      const deps = listLayerDependencies(layer.id);
      const depIds: string[] = [];
      for (const dep of deps) {
        const depLayer = resolveByName(dep.dependency_name, dep.version_constraint, layer.name);
        depIds.push(depLayer.id);
      }
      visiting.delete(layer.name);
      resolved.set(layer.name, layer);
      dependencyMap[layer.id] = depIds;
      order.push(layer);
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

export function validateLayerDependencyGraph(
  rootName: string,
  rootDependencyNames: string[],
): void {
  const visiting = new Set<string>();

  function resolveDeps(layerName: string): string[] {
    if (layerName === rootName) {
      return rootDependencyNames;
    }
    const layer = getLayer(layerName);
    if (!layer) {
      return [];
    }
    return listLayerDependencies(layer.id).map((dep) => dep.dependency_name);
  }

  function visit(name: string): void {
    if (visiting.has(name)) {
      const path = [...visiting, name].join(" → ");
      throw new Error(`Layer dependency cycle detected: ${path}`);
    }
    visiting.add(name);
    for (const dep of resolveDeps(name)) {
      visit(dep);
    }
    visiting.delete(name);
  }

  visit(rootName);
}
