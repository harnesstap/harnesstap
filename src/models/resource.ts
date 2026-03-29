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

function rowToResource(row: ResourceRow): Resource {
  return {
    ...row,
    type: row.type as ResourceType,
    metadata: JSON.parse(row.metadata) as ResourceMetadata,
  };
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

export function getResource(id: string): Resource | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as
    | ResourceRow
    | undefined;
  return row ? rowToResource(row) : undefined;
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
  id: string,
  input: Partial<Pick<Resource, "name" | "description" | "content" | "metadata">>,
): Resource | undefined {
  const db = getDb();
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

  if (sets.length === 0) return getResource(id);

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE resources SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getResource(id);
}

export function deleteResource(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM resources WHERE id = ?").run(id);
  return result.changes > 0;
}
