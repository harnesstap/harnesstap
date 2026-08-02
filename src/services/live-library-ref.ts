import {
  createResource,
  findResourceByKey,
  upsertResource,
} from "../models/resource.js";
import type {
  Resource,
  ResourceCreateInput,
  ResourceMetadata,
  ResourceType,
} from "../types.js";

export const LIVE_CONTENT_STATUS = "live";

export function isLiveLibraryRef(
  resource: Pick<Resource, "metadata">,
): boolean {
  const metadata = resource.metadata as Record<string, unknown>;
  return metadata.content_status === LIVE_CONTENT_STATUS;
}

function withLiveMetadata(metadata: ResourceMetadata | undefined): ResourceMetadata {
  return {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    content_status: LIVE_CONTENT_STATUS,
  };
}

/**
 * Ensure a library row exists for an on-disk resource without snapshotting content.
 * Existing snapshotted (non-live) rows are left unchanged.
 */
export function ensureLiveLibraryRef(
  input: ResourceCreateInput,
  originRef: string,
): Resource {
  const namespace = input.namespace ?? "";
  const existing = findResourceByKey(
    input.type as ResourceType,
    input.name,
    namespace,
  );
  if (existing) {
    if (!isLiveLibraryRef(existing)) {
      return existing;
    }
    const nextOrigin = originRef || existing.origin_ref;
    const nextSource = input.source || existing.source;
    if (nextOrigin === existing.origin_ref && nextSource === existing.source) {
      return existing;
    }
    const updated = upsertResource(
      {
        type: existing.type,
        name: existing.name,
        namespace: existing.namespace,
        description: existing.description,
        content: existing.content,
        metadata: withLiveMetadata(existing.metadata),
        source: nextSource,
        origin_kind: "manual",
        origin_ref: nextOrigin,
      },
      { policy: "overwrite" },
    );
    return updated.action === "skipped" ? existing : updated.resource;
  }

  return createResource({
    type: input.type,
    name: input.name,
    namespace,
    description: input.description ?? "",
    content: "",
    metadata: withLiveMetadata(input.metadata),
    source: input.source,
    origin_kind: "manual",
    origin_ref: originRef || input.source,
  });
}
