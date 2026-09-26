import { hashResourceBody } from "./resource-hash.js";
import { resourceIdentity } from "./reference-resources.js";
import type { Resource, ResourceCreateInput } from "../types.js";
import { isClaudeLocalMcpResource } from "./claude-local-mcp.js";

export interface HarnessScanSlice {
  platformId: string;
  resources: ResourceCreateInput[];
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

function fingerprint(resource: ResourceCreateInput): string {
  return hashResourceBody({
    type: resource.type,
    content: resource.content,
    metadata: resource.metadata,
  });
}

/**
 * Union on-disk resources from every configured harness.
 * Same `type:name:namespace` keeps the main harness copy when content differs.
 */
export function unionHarnessResources(
  slices: readonly HarnessScanSlice[],
  mainHarness: string,
): UnionHarnessResourcesResult {
  const ordered = [
    ...slices.filter((slice) => slice.platformId === mainHarness),
    ...slices.filter((slice) => slice.platformId !== mainHarness),
  ];
  const byIdentity = new Map<
    string,
    { resource: ResourceCreateInput; platformId: string }
  >();
  const conflicts: UnionConflict[] = [];

  for (const slice of ordered) {
    for (const resource of slice.resources) {
      const identity = resourceIdentity(resource);
      const existing = byIdentity.get(identity);
      if (!existing) {
        byIdentity.set(identity, {
          resource,
          platformId: slice.platformId,
        });
        continue;
      }
      if (fingerprint(existing.resource) === fingerprint(resource)) {
        continue;
      }
      conflicts.push({
        identity,
        winnerPlatformId: existing.platformId,
        loserPlatformId: slice.platformId,
      });
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
        content_hash: fingerprint(resource),
        content_blob_ref: resource.content_blob_ref ?? "",
        source: portableSource,
        created_at: "",
        updated_at: "",
      };
    });
}
