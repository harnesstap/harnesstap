import type { Plugin } from "../types.js";
import {
  getPlugin,
  listPluginDependencies,
  parsePluginSelectorString,
} from "../models/plugin-model.js";
import { satisfiesConstraint } from "./plugin-constraints.js";

export interface PluginResolutionResult {
  /** Topologically ordered list of resolved plugins (dependencies before dependents). */
  resolved: Plugin[];
  /** Maps each plugin id to the ids of its direct dependencies. */
  dependencyMap: Record<string, string[]>;
}

/**
 * Resolve a set of root plugin selectors into a fully-ordered dependency graph.
 *
 * - Highest compatible local version wins for each name.
 * - Cycles throw an error naming the plugins involved.
 * - Missing compatible versions throw an error.
 * - Deduplicates plugins that appear in multiple dependency paths.
 */
export function resolvePluginGraph(rootSelectors: string[]): PluginResolutionResult {
  // name → chosen Plugin (for deduplication and cycle detection keyed by name)
  const resolved = new Map<string, Plugin>();
  // names currently on the DFS recursion stack (for cycle detection)
  const visiting = new Set<string>();
  const order: Plugin[] = [];
  const dependencyMap: Record<string, string[]> = {};

  function resolveByName(name: string, constraint: string | null, requestedBy: string): Plugin {
    if (visiting.has(name)) {
      const path = [...visiting, name].join(" → ");
      throw new Error(`Plugin dependency cycle detected: ${path}`);
    }
    const cached = resolved.get(name);
    if (cached) {
      if (constraint && !satisfiesConstraint(constraint, cached.version)) {
        throw new Error(
          `Plugin "${name}" was resolved to version ${cached.version} but "${requestedBy}" requires "${constraint}" — conflicting constraints`,
        );
      }
      return cached;
    }

    visiting.add(name);

    const selector = constraint ? `${name}@${constraint}` : name;
    const plugin = getPlugin(selector);
    if (!plugin) {
      throw new Error(
        `No compatible version found for plugin "${name}"${constraint ? ` matching "${constraint}"` : ""} (required by "${requestedBy}")`,
      );
    }

    const deps = listPluginDependencies(plugin.id);
    const depIds: string[] = [];

    for (const dep of deps) {
      const depPlugin = resolveByName(dep.dependency_name, dep.version_constraint, name);
      depIds.push(depPlugin.id);
    }

    visiting.delete(name);
    resolved.set(name, plugin);
    dependencyMap[plugin.id] = depIds;
    order.push(plugin);

    return plugin;
  }

  function resolveSelector(selector: string): void {
    const parsed = parsePluginSelectorString(selector);

    if (parsed.kind === "id") {
      // id-based lookup — if already resolved (by name), skip
      const plugin = getPlugin(selector);
      if (!plugin) {
        throw new Error(`No plugin found with id "${selector}"`);
      }
      // Use name for dedup tracking; if already resolved, verify it's the same plugin
      const cached = resolved.get(plugin.name);
      if (cached) {
        if (cached.id !== plugin.id) {
          throw new Error(
            `Plugin "${plugin.name}" was resolved to version ${cached.version} (id: ${cached.id}) but an explicit id selector "${selector}" targets version ${plugin.version} (id: ${plugin.id}) — conflicting selectors`,
          );
        }
        return;
      }

      visiting.add(plugin.name);
      const deps = listPluginDependencies(plugin.id);
      const depIds: string[] = [];
      for (const dep of deps) {
        const depPlugin = resolveByName(dep.dependency_name, dep.version_constraint, plugin.name);
        depIds.push(depPlugin.id);
      }
      visiting.delete(plugin.name);
      resolved.set(plugin.name, plugin);
      dependencyMap[plugin.id] = depIds;
      order.push(plugin);
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

export function validatePluginDependencyGraph(
  rootName: string,
  rootDependencyNames: string[],
): void {
  const visiting = new Set<string>();

  function resolveDeps(pluginName: string): string[] {
    if (pluginName === rootName) {
      return rootDependencyNames;
    }
    const plugin = getPlugin(pluginName);
    if (!plugin) {
      return [];
    }
    return listPluginDependencies(plugin.id).map((dep) => dep.dependency_name);
  }

  function visit(name: string): void {
    if (visiting.has(name)) {
      const path = [...visiting, name].join(" → ");
      throw new Error(`Plugin dependency cycle detected: ${path}`);
    }
    visiting.add(name);
    for (const dep of resolveDeps(name)) {
      visit(dep);
    }
    visiting.delete(name);
  }

  visit(rootName);
}
