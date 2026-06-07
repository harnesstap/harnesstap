import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import { mapResourceRow } from "./resource.js";
import type {
  Environment,
  EnvironmentSecretRef,
  EnvironmentSecretProvider,
  Resource,
} from "../types.js";

interface EnvironmentRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

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
  order: number;
}

interface EnvironmentSecretRefRow {
  environment_id: string;
  key: string;
  provider: string;
  ref: string;
}

function rowToEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createEnvironment(input: {
  name: string;
  description?: string;
}): Environment {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO environments (id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.description ?? "", now, now);

  return {
    id,
    name: input.name,
    description: input.description ?? "",
    created_at: now,
    updated_at: now,
  };
}

export function getEnvironment(id: string): Environment | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE id = ?")
    .get(id) as EnvironmentRow | undefined;
  return row ? rowToEnvironment(row) : undefined;
}

export function getEnvironmentByName(name: string): Environment | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE name = ?")
    .get(name) as EnvironmentRow | undefined;
  return row ? rowToEnvironment(row) : undefined;
}

export function listEnvironments(): Environment[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM environments ORDER BY name")
    .all() as EnvironmentRow[];
  return rows.map(rowToEnvironment);
}

export function deleteEnvironment(environmentId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM environments WHERE id = ?")
    .run(environmentId);
  return result.changes > 0;
}

export function addResourceToEnvironment(
  environmentId: string,
  resource: { id: string },
): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM environment_resources WHERE environment_id = ?',
    )
    .get(environmentId) as { max_order: number };

  db.prepare(
    'INSERT OR IGNORE INTO environment_resources (environment_id, resource_id, "order") VALUES (?, ?, ?)',
  ).run(environmentId, resource.id, maxOrder.max_order + 1);
}

export function removeResourceFromEnvironment(
  environmentId: string,
  resourceId: string,
): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM environment_resources WHERE environment_id = ? AND resource_id = ?",
  ).run(environmentId, resourceId);
}

export function getEnvironmentResources(environmentId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, er."order" FROM resources r
       JOIN environment_resources er ON er.resource_id = r.id
       WHERE er.environment_id = ?
       ORDER BY er."order"`,
    )
    .all(environmentId) as ResourceRow[];

  return rows.map(mapResourceRow);
}

export function addSecretRefToEnvironment(
  environmentId: string,
  key: string,
  provider: EnvironmentSecretProvider,
  ref: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO environment_secret_refs (environment_id, key, provider, ref)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(environment_id, key) DO UPDATE SET provider = excluded.provider, ref = excluded.ref`,
  ).run(environmentId, key, provider, ref);
}

export function getEnvironmentSecretRefs(
  environmentId: string,
): EnvironmentSecretRef[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM environment_secret_refs WHERE environment_id = ? ORDER BY key",
    )
    .all(environmentId) as EnvironmentSecretRefRow[];

  return rows.map((row) => ({
    environment_id: row.environment_id,
    key: row.key,
    provider: row.provider as EnvironmentSecretProvider,
    ref: row.ref,
  }));
}

export function removeSecretRefFromEnvironment(
  environmentId: string,
  key: string,
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      "DELETE FROM environment_secret_refs WHERE environment_id = ? AND key = ?",
    )
    .run(environmentId, key);
  return result.changes > 0;
}
