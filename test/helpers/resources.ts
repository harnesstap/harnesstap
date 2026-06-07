import type {
  OriginKind,
  Resource,
  ResourceMetadata,
  ResourceType,
} from "../../src/types.ts";

export function makeResourceInput(
  overrides: Partial<{
    type: ResourceType;
    name: string;
    description: string;
    content: string;
    metadata: ResourceMetadata;
    source: string;
    namespace: string;
    origin_kind: OriginKind;
    origin_ref: string;
    content_hash: string;
    content_blob_ref: string;
  }> = {},
) {
  return {
    type: "skill" as ResourceType,
    name: "alpha",
    description: "Alpha resource",
    content: "# Alpha\n",
    metadata: {} as ResourceMetadata,
    source: "manual",
    namespace: "",
    origin_kind: "manual" as OriginKind,
    origin_ref: "",
    content_hash: "",
    content_blob_ref: "",
    ...overrides,
  };
}

export function makeResource(
  overrides: Partial<Resource> = {},
): Resource {
  const now = new Date().toISOString();
  return {
    id: "resource-1",
    created_at: now,
    updated_at: now,
    ...makeResourceInput(),
    ...overrides,
  };
}
