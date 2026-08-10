import { createHash } from "node:crypto";
import { getLayerResources } from "../../models/layer-model.js";
import { resourceClass } from "../../platforms/registry.js";
import { MATERIAL_RESOURCE_TYPES } from "../../types.js";
import type {
  EnvVarMetadata,
  LayerOverrides,
  MaterialResourceType,
  Resource,
} from "../../types.js";
import { SingletonConflictError } from "./types.js";
import type { ResourceDecision, ResourceSide, SelectedPlugin } from "./types.js";

interface Candidate {
  resource: Resource;
  side: ResourceSide;
  /** Sort key: layer declaration index, then resource order within the layer. */
  declarationIndex: number;
  resourceIndex: number;
}

function isMaterial(type: string): type is MaterialResourceType {
  return (MATERIAL_RESOURCE_TYPES as readonly string[]).includes(type);
}

/**
 * `env_var` is singleton per key, not per bundle: two layers setting different
 * values for the same variable is a real conflict, while disjoint variables
 * coexist.
 */
export function resolutionKey(resource: Resource): string {
  if (resource.type === "env_var") {
    const metadata = resource.metadata as EnvVarMetadata;
    return `env_var:${metadata.key || resource.name}`;
  }
  return `${resource.type}:${resource.name}`;
}

export function resourceFingerprint(resource: Resource): string {
  if (resource.content_hash) {
    return resource.content_hash;
  }
  return createHash("sha256")
    .update(resource.content)
    .update("\u0000")
    .update(JSON.stringify(resource.metadata ?? {}))
    .digest("hex");
}

export interface ResolveResourcesResult {
  resources: Resource[];
  decisions: ResourceDecision[];
  warnings: string[];
}

export function resolveResources(input: {
  selected: SelectedPlugin[];
  overrides: LayerOverrides;
  rootName: string;
  /**
   * Ephemeral argv sugar (`ht layer apply a b`): equal-depth singleton ties
   * use declaration order (last wins) instead of erroring. Durable roots still
   * error so diamond conflicts stay explicit.
   */
  declarationOrderSingletons?: boolean;
}): ResolveResourcesResult {
  const candidates = new Map<string, Candidate[]>();
  const keyOrder: string[] = [];

  const ordered = [...input.selected].sort(
    (a, b) => a.depth - b.depth || a.declarationIndex - b.declarationIndex,
  );

  for (const plugin of ordered) {
    const attached = getLayerResources(plugin.layerId);
    for (let index = 0; index < attached.length; index += 1) {
      const resource = attached[index];
      if (!resource || !isMaterial(resource.type)) continue;
      const key = resolutionKey(resource);
      const bucket = candidates.get(key);
      if (bucket) {
        bucket.push({
          resource,
          side: {
            layerName: plugin.name,
            layerVersion: plugin.version,
            depth: plugin.depth,
          },
          declarationIndex: plugin.declarationIndex,
          resourceIndex: index,
        });
      } else {
        keyOrder.push(key);
        candidates.set(key, [
          {
            resource,
            side: {
              layerName: plugin.name,
              layerVersion: plugin.version,
              depth: plugin.depth,
            },
            declarationIndex: plugin.declarationIndex,
            resourceIndex: index,
          },
        ]);
      }
    }
  }

  const resources: Resource[] = [];
  const decisions: ResourceDecision[] = [];
  const warnings: string[] = [];

  for (const key of keyOrder) {
    const bucket = candidates.get(key);
    if (!bucket || bucket.length === 0) continue;

    const overrideLayer = input.overrides.resources[key];
    if (overrideLayer) {
      const chosen = bucket.find((c) => c.side.layerName === overrideLayer);
      if (chosen) {
        resources.push(chosen.resource);
        decisions.push({
          key,
          winner: chosen.side,
          losers: bucket.filter((c) => c !== chosen).map((c) => c.side),
          reason: "root-override",
        });
        continue;
      }
    }

    if (bucket.length === 1) {
      const only = bucket[0];
      if (!only) continue;
      resources.push(only.resource);
      decisions.push({
        key,
        winner: only.side,
        losers: [],
        reason: "only-candidate",
      });
      continue;
    }

    const minDepth = Math.min(...bucket.map((c) => c.side.depth));
    const shallowest = bucket.filter((c) => c.side.depth === minDepth);

    if (shallowest.length === 1) {
      const winner = shallowest[0];
      if (!winner) continue;
      resources.push(winner.resource);
      decisions.push({
        key,
        winner: winner.side,
        losers: bucket.filter((c) => c !== winner).map((c) => c.side),
        reason: "nearest-to-root",
      });
      continue;
    }

    const fingerprints = new Set(
      shallowest.map((c) => resourceFingerprint(c.resource)),
    );
    if (fingerprints.size === 1) {
      const winner = shallowest[0];
      if (!winner) continue;
      resources.push(winner.resource);
      decisions.push({
        key,
        winner: winner.side,
        losers: bucket.filter((c) => c !== winner).map((c) => c.side),
        reason: "identical-content",
      });
      continue;
    }

    const firstResource = shallowest[0]?.resource;
    if (!firstResource || !isMaterial(firstResource.type)) continue;

    if (
      resourceClass(firstResource.type) === "singleton" &&
      !input.declarationOrderSingletons
    ) {
      throw new SingletonConflictError({
        key,
        sides: shallowest.map((c) => c.side),
        rootName: input.rootName,
      });
    }

    // Equal depth, differing content: declaration order decides.
    // Last declared wins, which is what `ht layer apply a b` has always meant.
    const sorted = [...shallowest].sort(
      (a, b) =>
        a.declarationIndex - b.declarationIndex || a.resourceIndex - b.resourceIndex,
    );
    const winner = sorted[sorted.length - 1];
    if (!winner) continue;
    resources.push(winner.resource);
    decisions.push({
      key,
      winner: winner.side,
      losers: bucket.filter((c) => c !== winner).map((c) => c.side),
      reason: "declaration-order",
    });
    warnings.push(
      `${key} is declared by ${shallowest
        .map((c) => c.side.layerName)
        .join(" and ")} at the same depth with different content; ` +
        `${winner.side.layerName} wins because it is declared last.`,
    );
  }

  return { resources, decisions, warnings };
}
