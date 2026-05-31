import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type { Resource, ResourceType, ResourceMetadata } from "../types.js";

interface ResourceRow {
  id: string;
  type: string;
  name: string;
  description: string;
  content: string;
  metadata: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export type ResourceLookupResult =
  | { status: "found"; resource: Resource }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: Resource[] };

function rowToResource(row: ResourceRow): Resource {
  return {
    ...row,
    type: row.type as ResourceType,
    metadata: JSON.parse(row.metadata) as ResourceMetadata,
  };
}

export function resolveResource(nameOrId: string): ResourceLookupResult {
  const db = getDb();
  const row = db.prepare("SELECT * FROM resources WHERE id = ?").get(nameOrId) as
    | ResourceRow
    | undefined;

  if (row) {
    return { status: "found", resource: rowToResource(row) };
  }

  const nameRows = db
    .prepare("SELECT * FROM resources WHERE name = ? ORDER BY created_at DESC")
    .all(nameOrId) as ResourceRow[];

  if (nameRows.length === 0) {
    return { status: "not_found" };
  }

  if (nameRows.length > 1) {
    return {
      status: "ambiguous",
      matches: nameRows.map(rowToResource),
    };
  }

  const [nameRow] = nameRows;
  if (!nameRow) {
    return { status: "not_found" };
  }

  return { status: "found", resource: rowToResource(nameRow) };
}

export function createResource(
  input: Omit<Resource, "id" | "created_at" | "updated_at">,
): Resource {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.name,
    input.description,
    input.content,
    JSON.stringify(input.metadata),
    input.source,
    now,
    now,
  );

  return { ...input, id, created_at: now, updated_at: now };
}

export function getResource(nameOrId: string): Resource | undefined {
  const result = resolveResource(nameOrId);
  return result.status === "found" ? result.resource : undefined;
}

export function getResourcesByIds(resourceIds: string[]): Resource[] {
  return resourceIds
    .map((resourceId) => getResource(resourceId))
    .filter((resource): resource is Resource => Boolean(resource));
}

export function listResources(filters?: {
  type?: ResourceType;
  search?: string;
}): Resource[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  if (filters?.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM resources ${where} ORDER BY created_at DESC`)
    .all(...params) as ResourceRow[];

  return rows.map(rowToResource);
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

export function deleteResource(nameOrId: string): boolean {
  const db = getDb();
  const result = resolveResource(nameOrId);
  if (result.status !== "found") {
    return false;
  }
  const deleteResult = db.prepare("DELETE FROM resources WHERE id = ?").run(result.resource.id);
  return deleteResult.changes > 0;
}
