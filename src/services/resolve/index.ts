import { getDb } from "../../db/connection.js";
import {
  addResourceToPlugin,
  createPlugin,
  deletePlugin,
  getPluginById,
  getPluginResources,
  resolvePluginSelector,
} from "../../models/plugin-model.js";
import type { Resource } from "../../types.js";
import { ensurePluginResource } from "../plugin-composition.js";
import { isHostPluginPinResource } from "../host-plugin-serialize.js";
import { getPluginOverrides } from "../plugin-overrides.js";
import type { SelectedPlugin } from "./types.js";
import { walkDependencyGraph } from "./dependency-graph.js";
import { resolveResources } from "./resource-resolution.js";
import type { ResolutionResult } from "./types.js";

export * from "./types.js";
export { resolutionKey, resourceFingerprint } from "./resource-resolution.js";

/** Prefix for synthesized roots. Never persisted beyond one resolution. */
const EPHEMERAL_PREFIX = "__ht_ephemeral_root__";

/**
 * Host plugin pins are composition resources, so material resolution drops them.
 * Claude and Cursor still need the plugin's own pin (ponytail@local) in the
 * apply set to register the install and to skip standalone copies of that
 * plugin's skills. Dependency edges named after other plugins are not pins.
 */
function appendHostPluginPins(
  selected: readonly SelectedPlugin[],
  resources: readonly Resource[],
): Resource[] {
  const seen = new Set(resources.map((resource) => resource.id));
  const pins: Resource[] = [];
  for (const plugin of selected) {
    if (plugin.name.startsWith(EPHEMERAL_PREFIX)) continue;
    for (const resource of getPluginResources(plugin.pluginId)) {
      if (resource.name !== plugin.name) continue;
      if (!resource.origin_ref?.includes("@")) continue;
      if (!isHostPluginPinResource(resource) || seen.has(resource.id)) {
        continue;
      }
      seen.add(resource.id);
      pins.push(resource);
    }
  }
  return pins.length === 0 ? [...resources] : [...resources, ...pins];
}

function createEphemeralRoot(selectors: string[]): string {
  const name = `${EPHEMERAL_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const root = createPlugin({ name, version: "0.0.0" });
  for (const selector of selectors) {
    const target = resolvePluginSelector(selector);
    if (!target) {
      deletePlugin(root.id);
      throw new Error(`Plugin not found: ${selector}`);
    }
    const reference = ensurePluginResource(`plugin:${target.name}`, {
      versionConstraint: target.version,
    });
    addResourceToPlugin(root.id, reference.id);
  }
  return root.id;
}

export interface ResolveCompositionInput {
  /** One selector resolves to that plugin as root; several synthesize a root. */
  rootSelectors: string[];
  /** Pin versions from a lockfile instead of re-mediating. */
  lockedVersions?: Map<string, string>;
}

/**
 * Resolve a composition into the exact resource set to materialize.
 *
 * Pass 1 unifies every plugin name to one version. Pass 2 flattens the
 * resulting plugins into one resource per `type:name`. Both passes contribute
 * to the explain trail on the result.
 */
export function resolveComposition(input: ResolveCompositionInput): ResolutionResult {
  const single = input.rootSelectors.length === 1 ? input.rootSelectors[0] : undefined;
  let rootPluginId: string;
  let ephemeral = false;

  if (single !== undefined) {
    const resolved = resolvePluginSelector(single);
    if (!resolved) {
      throw new Error(`Plugin not found: ${single}`);
    }
    rootPluginId = resolved.id;
  } else if (input.rootSelectors.length === 0) {
    throw new Error("Provide at least one plugin to resolve.");
  } else {
    rootPluginId = createEphemeralRoot(input.rootSelectors);
    ephemeral = true;
  }

  try {
    const root = getPluginById(rootPluginId);
    if (!root) {
      throw new Error(`Plugin not found: ${rootPluginId}`);
    }
    const overrides = getPluginOverrides(root.id);
    const walk = walkDependencyGraph({
      rootPluginId,
      ...(input.lockedVersions ? { lockedVersions: input.lockedVersions } : {}),
    });
    const pass2 = resolveResources({
      selected: walk.selected,
      overrides,
      rootName: root.name,
      ...(ephemeral ? { declarationOrderSingletons: true } : {}),
    });

    return {
      root: {
        name: root.name,
        version: root.version,
        pluginId: root.id,
        ephemeral,
      },
      selected: walk.selected,
      resources: appendHostPluginPins(walk.selected, pass2.resources),
      decisions: pass2.decisions,
      warnings: pass2.warnings,
    };
  } finally {
    if (ephemeral) {
      // The synthesized root exists only for the duration of one resolution.
      const db = getDb();
      db.prepare("DELETE FROM plugins WHERE id = ?").run(rootPluginId);
    }
  }
}
