import { getDb, getHarnesstapDir } from "../db/connection.js";
import { ulid } from "ulid";
import type {
  Resource,
  ResourceCreateInput,
  ResourceType,
  ResourceMetadata,
  OriginKind,
  ListableResourceType,
} from "../types.js";
import { LISTABLE_RESOURCE_TYPES } from "../types.js";
import { writeBlob } from "../services/blob-store.js";

export type { ResourceCreateInput };
import { hashResourceBody } from "../services/resource-hash.js";
import { parseResourceSelector } from "../services/resource-selector.js";

const INLINE_CONTENT_THRESHOLD = 4096;
const ULID_PATTERN = /^[0-9A-Z]{26}$/;

interface ResourceRow {
  id: string;
  type: string;
  name: string;
  description: string;
  content: string;
  metadata: string;
  source: string;
  namespace?: string;
  origin_kind?: string;
  origin_ref?: string;
  content_hash?: string;
  content_blob_ref?: string;
  created_at: string;
  updated_at: string;
}

export type ResourceLookupResult =
  | { status: "found"; resource: Resource }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: Resource[] };

export type ResourceResolveMode = "display" | "compose";

export type ImportConflictPolicy = "prompt" | "skip" | "overwrite" | "fail";

export interface UpsertResourceInput {
  type: ResourceType;
  name: string;
  namespace?: string;
  description: string;
  content: string;
  metadata: ResourceMetadata;
  source: string;
  origin_kind: OriginKind;
  origin_ref?: string;
}

export function normalizeResourceInput(input: ResourceCreateInput): UpsertResourceInput {
  return {
    type: input.type,
    name: input.name,
    namespace: input.namespace ?? "",
    description: input.description,
    content: input.content,
    metadata: input.metadata,
    source: input.source,
    origin_kind: input.origin_kind ?? "manual",
    origin_ref: input.origin_ref ?? "",
  };
}

export function formatResourceSelector(
  resource: Pick<Resource, "type" | "name" | "namespace">,
  options?: { includeType?: boolean },
): string {
  const namePart = resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
  if (options?.includeType) {
    return `${resource.type}:${namePart}`;
  }
  return namePart;
}

export type UpsertResult =
  | { action: "created"; resource: Resource }
  | { action: "unchanged"; resource: Resource }
  | { action: "updated"; resource: Resource }
  | { action: "skipped"; existing: Resource };

export interface UpsertOptions {
  policy?: ImportConflictPolicy;
  harnesstapDir?: string;
}

export function mapResourceRow(row: ResourceRow): Resource {
  return {
    ...row,
    type: row.type as ResourceType,
    metadata: JSON.parse(row.metadata) as ResourceMetadata,
    namespace: row.namespace ?? "",
    origin_kind: (row.origin_kind ?? "manual") as OriginKind,
    origin_ref: row.origin_ref ?? "",
    content_hash: row.content_hash ?? "",
    content_blob_ref: row.content_blob_ref ?? "",
  };
}

function isUlid(selector: string): boolean {
  return ULID_PATTERN.test(selector);
}

function findResourceById(id: string): Resource | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as
    | ResourceRow
    | undefined;
  return row ? mapResourceRow(row) : undefined;
}

export function findResourceByKey(
  type: ResourceType,
  name: string,
  namespace: string,
): Resource | undefined {
  return findExistingResource(type, name, namespace);
}

function findResourcesBySelector(parsed: {
  type?: ResourceType;
  name: string;
  namespace: string;
}): Resource[] {
  const db = getDb();
  const conditions = ["name = ?"];
  const params: unknown[] = [parsed.name];

  if (parsed.type) {
    conditions.push("type = ?");
    params.push(parsed.type);
  }
  if (parsed.namespace) {
    conditions.push("namespace = ?");
    params.push(parsed.namespace);
  }

  const rows = db
    .prepare(`SELECT * FROM resources WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params) as ResourceRow[];

  return rows.map(mapResourceRow);
}

function resolveFromMatches(
  matches: Resource[],
  mode: ResourceResolveMode,
): ResourceLookupResult {
  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length === 1) {
    const [match] = matches;
    return match ? { status: "found", resource: match } : { status: "not_found" };
  }

  if (mode === "display") {
    const unnamespaced = matches.filter((match) => match.namespace === "");
    if (unnamespaced.length === 1) {
      const [match] = unnamespaced;
      return match ? { status: "found", resource: match } : { status: "ambiguous", matches };
    }
  }

  return { status: "ambiguous", matches };
}

export function resolveResource(
  selector: string,
  options?: { mode?: ResourceResolveMode },
): ResourceLookupResult {
  const mode = options?.mode ?? "display";

  if (isUlid(selector)) {
    const byId = findResourceById(selector);
    if (byId) {
      return { status: "found", resource: byId };
    }
  }

  const parsed = parseResourceSelector(selector);

  if (isUlid(parsed.name)) {
    const byId = findResourceById(parsed.name);
    if (byId) {
      if (!parsed.type || byId.type === parsed.type) {
        return { status: "found", resource: byId };
      }
      return { status: "not_found" };
    }
  }

  if (parsed.namespace) {
    const matches = findResourcesBySelector(parsed);
    return resolveFromMatches(matches, mode);
  }

  const matches = findResourcesBySelector(parsed);
  if (mode === "compose" && matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return resolveFromMatches(matches, mode);
}

function contentBlobRef(contentHash: string): string {
  const hex = contentHash.replace(/^sha256:/, "");
  return `blobs/sha256/${hex.slice(0, 2)}/${hex}`;
}

function persistContent(
  harnesstapDir: string,
  contentHash: string,
  content: string,
): { inlineContent: string; contentBlobRef: string } {
  writeBlob(harnesstapDir, contentHash, content);
  const blobRef = contentBlobRef(contentHash);
  if (content.length <= INLINE_CONTENT_THRESHOLD) {
    return { inlineContent: content, contentBlobRef: blobRef };
  }
  return { inlineContent: "", contentBlobRef: blobRef };
}

function findExistingResource(
  type: ResourceType,
  name: string,
  namespace: string,
): Resource | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM resources WHERE type = ? AND name = ? AND namespace = ?")
    .get(type, name, namespace) as ResourceRow | undefined;
  return row ? mapResourceRow(row) : undefined;
}

function resolveConflictPolicy(policy: ImportConflictPolicy): "overwrite" | "skip" | "fail" {
  if (policy === "overwrite") return "overwrite";
  if (policy === "skip") return "skip";
  if (policy === "fail" || policy === "prompt") return "fail";
  return "fail";
}

export function upsertResource(
  input: UpsertResourceInput,
  options: UpsertOptions = {},
): UpsertResult {
  const db = getDb();
  const harnesstapDir = options.harnesstapDir ?? getHarnesstapDir();
  const namespace = input.namespace ?? "";
  const originRef = input.origin_ref ?? "";
  const contentHash = hashResourceBody({
    type: input.type,
    content: input.content,
    metadata: input.metadata,
  });
  const existing = findExistingResource(input.type, input.name, namespace);

  if (!existing) {
    const now = new Date().toISOString();
    const id = ulid();
    const { inlineContent, contentBlobRef: blobRef } = persistContent(
      harnesstapDir,
      contentHash,
      input.content,
    );

    db.prepare(
      `INSERT INTO resources (
        id, type, name, description, content, metadata, source,
        namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.type,
      input.name,
      input.description,
      inlineContent,
      JSON.stringify(input.metadata),
      input.source,
      namespace,
      input.origin_kind,
      originRef,
      contentHash,
      blobRef,
      now,
      now,
    );

    return {
      action: "created",
      resource: {
        id,
        type: input.type,
        name: input.name,
        description: input.description,
        content: input.content,
        metadata: input.metadata,
        source: input.source,
        namespace,
        origin_kind: input.origin_kind,
        origin_ref: originRef,
        content_hash: contentHash,
        content_blob_ref: blobRef,
        created_at: now,
        updated_at: now,
      },
    };
  }

  if (existing.content_hash === contentHash) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE resources SET origin_ref = ?, updated_at = ? WHERE id = ?`,
    ).run(originRef || existing.origin_ref, now, existing.id);
    return {
      action: "unchanged",
      resource: {
        ...existing,
        origin_ref: originRef || existing.origin_ref,
        updated_at: now,
      },
    };
  }

  const policy = options.policy ?? "skip";
  const decision = resolveConflictPolicy(policy);

  if (decision === "skip") {
    return { action: "skipped", existing };
  }
  if (decision === "fail") {
    throw new Error(
      `Resource conflict: ${input.type}:${input.name}${namespace ? `@${namespace}` : ""} exists with different content`,
    );
  }

  const now = new Date().toISOString();
  const { inlineContent, contentBlobRef: blobRef } = persistContent(
    harnesstapDir,
    contentHash,
    input.content,
  );

  db.prepare(
    `UPDATE resources SET
      description = ?, content = ?, metadata = ?, source = ?,
      origin_kind = ?, origin_ref = ?, content_hash = ?, content_blob_ref = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    input.description,
    inlineContent,
    JSON.stringify(input.metadata),
    input.source,
    input.origin_kind,
    originRef,
    contentHash,
    blobRef,
    now,
    existing.id,
  );

  return {
    action: "updated",
    resource: {
      ...existing,
      description: input.description,
      content: input.content,
      metadata: input.metadata,
      source: input.source,
      origin_kind: input.origin_kind,
      origin_ref: originRef,
      content_hash: contentHash,
      content_blob_ref: blobRef,
      updated_at: now,
    },
  };
}

export function createResource(input: ResourceCreateInput): Resource {
  const result = upsertResource(normalizeResourceInput(input), { policy: "overwrite" });

  if (result.action === "skipped") {
    throw new Error(
      `Resource already exists: ${formatResourceSelector(
        { type: input.type, name: input.name, namespace: input.namespace ?? "" },
        { includeType: true },
      )}`,
    );
  }

  return result.resource;
}

export function getResource(
  nameOrId: string,
  options?: { mode?: ResourceResolveMode },
): Resource | undefined {
  const result = resolveResource(nameOrId, options);
  return result.status === "found" ? result.resource : undefined;
}

export function getResourcesByIds(resourceIds: string[]): Resource[] {
  return resourceIds
    .map((resourceId) => getResource(resourceId))
    .filter((resource): resource is Resource => Boolean(resource));
}

export function listResources(filters?: {
  type?: ResourceType | ListableResourceType;
  search?: string;
  origin_kind?: OriginKind;
  includeComposition?: boolean;
}): Resource[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  } else if (!filters?.includeComposition) {
    const listable = LISTABLE_RESOURCE_TYPES as readonly string[];
    conditions.push(`type IN (${listable.map(() => "?").join(", ")})`);
    params.push(...listable);
  }
  if (filters?.origin_kind) {
    conditions.push("origin_kind = ?");
    params.push(filters.origin_kind);
  }
  if (filters?.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM resources ${where} ORDER BY updated_at DESC`)
    .all(...params) as ResourceRow[];

  return rows.map(mapResourceRow);
}

export function listLinkedResources(selector?: string): Resource[] {
  const linked = listResources({ origin_kind: "marketplace_link" });
  if (!selector) {
    return linked;
  }
  const result = resolveResource(selector, { mode: "compose" });
  if (result.status === "found") {
    return result.resource.origin_kind === "marketplace_link" ? [result.resource] : [];
  }
  if (result.status === "ambiguous") {
    return result.matches.filter((resource) => resource.origin_kind === "marketplace_link");
  }
  return [];
}

export function updateResource(
  nameOrId: string,
  input: Partial<Pick<Resource, "name" | "description" | "content" | "metadata">>,
): Resource | undefined {
  const db = getDb();
  const result = resolveResource(nameOrId);
  if (result.status !== "found") {
    return undefined;
  }
  const resource = result.resource;
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.content !== undefined) {
    sets.push("content = ?");
    params.push(input.content);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return resource;

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(resource.id);

  db.prepare(`UPDATE resources SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getResource(resource.id);
}

/** Rewrite type=layer resources that point at a renamed layer. */
export function renameLayerTypedResources(
  oldName: string,
  newName: string,
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT id, namespace, origin_ref FROM resources WHERE type = 'plugin' AND name = ?`,
    )
    .all(oldName) as Array<{ id: string; namespace: string; origin_ref: string }>;

  let updated = 0;
  for (const row of rows) {
    if (findResourceByKey("plugin", newName, row.namespace)) {
      continue;
    }
    const originRef = row.origin_ref === oldName ? newName : row.origin_ref;
    db.prepare(
      `UPDATE resources SET name = ?, origin_ref = ?, updated_at = ? WHERE id = ?`,
    ).run(newName, originRef, now, row.id);
    updated += 1;
  }
  return updated;
}

export function listResourcesByOriginRef(
  originRef: string,
  originKind: OriginKind = "local_snapshot",
): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM resources WHERE origin_ref = ? AND origin_kind = ? ORDER BY updated_at DESC",
    )
    .all(originRef, originKind) as ResourceRow[];
  return rows.map(mapResourceRow);
}

export function deleteResource(nameOrId: string): boolean {
  const db = getDb();
  const result = resolveResource(nameOrId);
  if (result.status !== "found") {
    return false;
  }
  const deleteResult = db.prepare("DELETE FROM resources WHERE id = ?").run(result.resource.id);
  return deleteResult.changes > 0;
}
