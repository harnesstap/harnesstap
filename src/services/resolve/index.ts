import { getDb } from "../../db/connection.js";
import {
  addResourceToLayer,
  createLayer,
  deleteLayer,
  getLayerById,
  resolveLayerSelector,
} from "../../models/layer-model.js";
import { ensureLayerResource } from "../layer-composition.js";
import { getLayerOverrides } from "../layer-overrides.js";
import { walkDependencyGraph } from "./dependency-graph.js";
import { resolveResources } from "./resource-resolution.js";
import type { ResolutionResult } from "./types.js";

export * from "./types.js";
export { resolutionKey, resourceFingerprint } from "./resource-resolution.js";

/** Prefix for synthesized roots. Never persisted beyond one resolution. */
const EPHEMERAL_PREFIX = "__ht_ephemeral_root__";

function createEphemeralRoot(selectors: string[]): string {
  const name = `${EPHEMERAL_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const root = createLayer({ name, version: "0.0.0" });
  for (const selector of selectors) {
    const target = resolveLayerSelector(selector);
    if (!target) {
      deleteLayer(root.id);
      throw new Error(`Layer not found: ${selector}`);
    }
    const reference = ensureLayerResource(`layer:${target.name}`, {
      versionConstraint: target.version,
    });
    addResourceToLayer(root.id, reference.id);
  }
  return root.id;
}

export interface ResolveCompositionInput {
  /** One selector resolves to that layer as root; several synthesize a root. */
  rootSelectors: string[];
  /** Pin versions from a lockfile instead of re-mediating. */
  lockedVersions?: Map<string, string>;
}

/**
 * Resolve a composition into the exact resource set to materialize.
 *
 * Pass 1 unifies every plugin name to one version. Pass 2 flattens the
 * resulting layers into one resource per `type:name`. Both passes contribute
 * to the explain trail on the result.
 */
export function resolveComposition(input: ResolveCompositionInput): ResolutionResult {
  const single = input.rootSelectors.length === 1 ? input.rootSelectors[0] : undefined;
  let rootLayerId: string;
  let ephemeral = false;

  if (single !== undefined) {
    const resolved = resolveLayerSelector(single);
    if (!resolved) {
      throw new Error(`Layer not found: ${single}`);
    }
    rootLayerId = resolved.id;
  } else if (input.rootSelectors.length === 0) {
    throw new Error("Provide at least one layer to resolve.");
  } else {
    rootLayerId = createEphemeralRoot(input.rootSelectors);
    ephemeral = true;
  }

  try {
    const root = getLayerById(rootLayerId);
    if (!root) {
      throw new Error(`Layer not found: ${rootLayerId}`);
    }
    const overrides = getLayerOverrides(root.id);
    const walk = walkDependencyGraph({
      rootLayerId,
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
        layerId: root.id,
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
      db.prepare("DELETE FROM layers WHERE id = ?").run(rootLayerId);
    }
  }
}
