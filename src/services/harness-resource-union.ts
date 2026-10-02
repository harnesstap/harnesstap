import { hashResourceBody } from "./resource-hash.js";
import { resourceIdentity } from "./reference-resources.js";
import type { Resource, ResourceCreateInput } from "../types.js";
import { isClaudeLocalMcpResource } from "./claude-local-mcp.js";

export interface HarnessScanSlice {
  platformId: string;
  resources: ResourceCreateInput[];
  /** identity → mtime ms; used by last-write conflict policy. */
  mtimesMs?: ReadonlyMap<string, number>;
}

export interface UnionConflict {
  identity: string;
  winnerPlatformId: string;
  loserPlatformId: string;
}

export interface UnionHarnessResourcesResult {
  resources: ResourceCreateInput[];
  conflicts: UnionConflict[];
}

export type HarnessUnionConflictPolicy = "last-write";

export function resourceFingerprint(resource: ResourceCreateInput): string {
  return hashResourceBody({
    type: resource.type,
    content: resource.content,
    metadata: resource.metadata,
  });
}

function mtimeOf(
  slice: HarnessScanSlice,
  identity: string,
): number {
  return slice.mtimesMs?.get(identity) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Union on-disk resources from every configured harness.
 * Same `type:name:namespace` keeps the newest mtime; equal/missing mtimes
 * keep the later slice (registered-set order).
 */
export function unionHarnessResources(
  slices: readonly HarnessScanSlice[],
  _conflictPolicy: HarnessUnionConflictPolicy = "last-write",
): UnionHarnessResourcesResult {
  const byIdentity = new Map<
    string,
    { resource: ResourceCreateInput; platformId: string; mtime: number }
  >();
  const conflicts: UnionConflict[] = [];

  for (const slice of slices) {
    for (const resource of slice.resources) {
      const identity = resourceIdentity(resource);
      const existing = byIdentity.get(identity);
      const mtime = mtimeOf(slice, identity);
      if (!existing) {
        byIdentity.set(identity, {
          resource,
          platformId: slice.platformId,
          mtime,
        });
        continue;
      }
      if (resourceFingerprint(existing.resource) === resourceFingerprint(resource)) {
        if (mtime > existing.mtime) {
          existing.mtime = mtime;
          existing.platformId = slice.platformId;
        }
        continue;
      }
      const takeIncoming = mtime >= existing.mtime;
      if (takeIncoming) {
        conflicts.push({
          identity,
          winnerPlatformId: slice.platformId,
          loserPlatformId: existing.platformId,
        });
        byIdentity.set(identity, {
          resource,
          platformId: slice.platformId,
          mtime,
        });
      } else {
        conflicts.push({
          identity,
          winnerPlatformId: existing.platformId,
          loserPlatformId: slice.platformId,
        });
      }
    }
  }

  return {
    resources: [...byIdentity.values()].map((entry) => entry.resource),
    conflicts,
  };
}

/** MCP path-binding must not block cross-harness emit.
 * Claude local-scope MCP is inventory-only and is never rewritten as portable.
 */
export function toPortableEmitResources(
  resources: ResourceCreateInput[],
): Resource[] {
  return resources
    .filter((resource) => !isClaudeLocalMcpResource(resource))
    .map((resource) => {
      const portableSource =
        resource.type === "mcp_server" ? "manual" : resource.source;
      return {
        ...resource,
        id: `sync:${resourceIdentity(resource)}`,
        namespace: resource.namespace ?? "",
        origin_kind: resource.origin_kind ?? "manual",
        origin_ref: resource.origin_ref ?? resource.source,
        content_hash: resourceFingerprint(resource),
        content_blob_ref: resource.content_blob_ref ?? "",
        source: portableSource,
        created_at: "",
        updated_at: "",
      };
    });
}
