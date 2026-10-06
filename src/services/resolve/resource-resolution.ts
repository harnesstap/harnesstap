import { createHash } from "node:crypto";
import { getPluginResources } from "../../models/plugin-model.js";
import { resourceClass } from "../../platforms/registry.js";
import { MATERIAL_RESOURCE_TYPES } from "../../types.js";
import type {
  EnvVarMetadata,
  PluginOverrides,
  MaterialResourceType,
  Resource,
} from "../../types.js";
import { previewConflictContent, SingletonConflictError } from "./types.js";
import type { ResourceDecision, ResourceSide, SelectedPlugin } from "./types.js";
import {
  applyIncomingHarnessScope,
  incomingScopeByPluginId,
} from "../harness-scope-graph.js";
import { HARNESS_SCOPE_ALL } from "../harness-scope.js";

interface Candidate {
  resource: Resource;
  side: ResourceSide;
  /** Sort key: plugin declaration index, then resource order within the plugin. */
  declarationIndex: number;
  resourceIndex: number;
}

function toSide(plugin: SelectedPlugin, resource: Resource): ResourceSide {
  return {
    pluginName: plugin.name,
    pluginVersion: plugin.version,
    depth: plugin.depth,
    resourceId: resource.id,
    source: resource.source,
    namespace: resource.namespace,
    fingerprint: resourceFingerprint(resource),
    preview: previewConflictContent(resource.content),
  };
}

function uniqueByFingerprint(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const fingerprint = resourceFingerprint(candidate.resource);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(candidate);
  }
  return unique;
}

function isMaterial(type: string): type is MaterialResourceType {
  return (MATERIAL_RESOURCE_TYPES as readonly string[]).includes(type);
}

/**
 * `env_var` is singleton per key, not per bundle: two plugins setting different
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
  overrides: PluginOverrides;
  rootName: string;
  /**
   * Ephemeral argv sugar (`ht plugin apply a b`): equal-depth singleton ties
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
  const incoming = incomingScopeByPluginId(ordered.map((plugin) => plugin.pluginId));

  for (const plugin of ordered) {
    const attached = applyIncomingHarnessScope(
      getPluginResources(plugin.pluginId),
      incoming.get(plugin.pluginId) ?? HARNESS_SCOPE_ALL,
    );
    for (let index = 0; index < attached.length; index += 1) {
      const resource = attached[index];
      if (!resource || !isMaterial(resource.type)) continue;
      const key = resolutionKey(resource);
      const bucket = candidates.get(key);
      const candidate: Candidate = {
        resource,
        side: toSide(plugin, resource),
        declarationIndex: plugin.declarationIndex,
        resourceIndex: index,
      };
      if (bucket) {
        bucket.push(candidate);
      } else {
        keyOrder.push(key);
        candidates.set(key, [candidate]);
      }
    }
  }

  const resources: Resource[] = [];
  const decisions: ResourceDecision[] = [];
  const warnings: string[] = [];

  for (const key of keyOrder) {
    const bucket = candidates.get(key);
    if (!bucket || bucket.length === 0) continue;

    const overrideValue = input.overrides.resources[key];
    if (overrideValue) {
      const chosen =
        bucket.find((c) => c.resource.id === overrideValue)
        ?? bucket.find((c) => c.side.pluginName === overrideValue);
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

    const uniqueShallowest = uniqueByFingerprint(shallowest);
    if (uniqueShallowest.length === 1) {
      const winner = uniqueShallowest[0];
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

    const firstResource = uniqueShallowest[0]?.resource;
    if (!firstResource || !isMaterial(firstResource.type)) continue;

    if (
      resourceClass(firstResource.type) === "singleton" &&
      !input.declarationOrderSingletons
    ) {
      throw new SingletonConflictError({
        key,
        sides: uniqueShallowest.map((c) => c.side),
        rootName: input.rootName,
      });
    }

    // Equal depth, differing content: declaration order decides.
    // Last declared wins, which is what `ht plugin apply a b` has always meant.
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
        .map((c) => c.side.pluginName)
        .join(" and ")} at the same depth with different content; ` +
        `${winner.side.pluginName} wins because it is declared last.`,
    );
  }

  return { resources, decisions, warnings };
}
