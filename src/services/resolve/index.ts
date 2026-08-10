import { getDb } from "../../db/connection.js";
import {
  addResourceToPlugin,
  createPlugin,
  deletePlugin,
  getPluginById,
  resolvePluginSelector,
} from "../../models/plugin-model.js";
import { ensurePluginResource } from "../plugin-composition.js";
import { getPluginOverrides } from "../plugin-overrides.js";
import { walkDependencyGraph } from "./dependency-graph.js";
import { resolveResources } from "./resource-resolution.js";
import type { ResolutionResult } from "./types.js";

export * from "./types.js";
export { resolutionKey, resourceFingerprint } from "./resource-resolution.js";

/** Prefix for synthesized roots. Never persisted beyond one resolution. */
const EPHEMERAL_PREFIX = "__ht_ephemeral_root__";

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
      resources: pass2.resources,
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
