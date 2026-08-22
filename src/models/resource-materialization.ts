import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type {
  MaterializationAction,
  MaterializationScope,
  ResourceMaterialization,
} from "../types.js";

interface ResourceMaterializationRow {
  id: string;
  resource_id: string;
  scope: MaterializationScope;
  project_id: string | null;
  root_path: string;
  platform_id: string;
  path: string;
  action: MaterializationAction;
  ownership_key: string;
  generated_hash: string;
  managed_container: number;
  created_at: string;
  updated_at: string;
}

function rowToMaterialization(
  row: ResourceMaterializationRow,
): ResourceMaterialization {
  return {
    ...row,
    managed_container: row.managed_container === 1,
  };
}

export function recordResourceMaterialization(input: {
  resource_id: string;
  scope: MaterializationScope;
  project_id?: string | null;
  root_path: string;
  platform_id: string;
  path: string;
  action: MaterializationAction;
  ownership_key: string;
  generated_hash: string;
  managed_container?: boolean;
}): ResourceMaterialization {
  const db = getDb();
  const now = new Date().toISOString();
  const projectId = input.project_id ?? null;
  const managedContainer = input.managed_container ? 1 : 0;

  const existing = db
    .prepare(
      `SELECT id FROM resource_materializations
       WHERE resource_id = ?
         AND scope = ?
         AND project_id IS ?
         AND root_path = ?
         AND platform_id = ?
         AND path = ?
         AND ownership_key = ?`,
    )
    .get(
      input.resource_id,
      input.scope,
      projectId,
      input.root_path,
      input.platform_id,
      input.path,
      input.ownership_key,
    ) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE resource_materializations
       SET action = ?,
           generated_hash = ?,
           managed_container = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.action,
      input.generated_hash,
      managedContainer,
      now,
      existing.id,
    );

    const row = db
      .prepare("SELECT * FROM resource_materializations WHERE id = ?")
      .get(existing.id) as ResourceMaterializationRow;
    return rowToMaterialization(row);
  }

  const id = ulid();
  db.prepare(
    `INSERT INTO resource_materializations (
      id, resource_id, scope, project_id, root_path, platform_id, path,
      action, ownership_key, generated_hash, managed_container, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.resource_id,
    input.scope,
    projectId,
    input.root_path,
    input.platform_id,
    input.path,
    input.action,
    input.ownership_key,
    input.generated_hash,
    managedContainer,
    now,
    now,
  );

  return {
    id,
    resource_id: input.resource_id,
    scope: input.scope,
    project_id: projectId,
    root_path: input.root_path,
    platform_id: input.platform_id,
    path: input.path,
    action: input.action,
    ownership_key: input.ownership_key,
    generated_hash: input.generated_hash,
    managed_container: input.managed_container ?? false,
    created_at: now,
    updated_at: now,
  };
}

export function listResourceMaterializations(
  resourceId: string,
): ResourceMaterialization[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM resource_materializations
       WHERE resource_id = ?
       ORDER BY created_at ASC`,
    )
    .all(resourceId) as ResourceMaterializationRow[];
  return rows.map(rowToMaterialization);
}

export function deleteResourceMaterializations(resourceId: string): number {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM resource_materializations WHERE resource_id = ?")
    .run(resourceId);
  return result.changes;
}

export function replaceMaterializationsForPlatform(input: {
  scope: MaterializationScope;
  project_id?: string | null;
  root_path: string;
  platform_id: string;
  entries: Array<{
    resource_id: string;
    path: string;
    action: MaterializationAction;
    ownership_key: string;
    generated_hash: string;
    managed_container: boolean;
  }>;
}): void {
  const db = getDb();
  const projectId = input.project_id ?? null;
  const entries = input.entries.filter((entry) =>
    db.prepare("SELECT 1 as ok FROM resources WHERE id = ? LIMIT 1").get(entry.resource_id),
  );
  if (entries.length === 0 && input.entries.length > 0) {
    return;
  }

  db.prepare(
    `DELETE FROM resource_materializations
     WHERE scope = ?
       AND project_id IS ?
       AND root_path = ?
       AND platform_id = ?`,
  ).run(input.scope, projectId, input.root_path, input.platform_id);

  for (const entry of entries) {
    recordResourceMaterialization({
      resource_id: entry.resource_id,
      scope: input.scope,
      project_id: projectId,
      root_path: input.root_path,
      platform_id: input.platform_id,
      path: entry.path,
      action: entry.action,
      ownership_key: entry.ownership_key,
      generated_hash: entry.generated_hash,
      managed_container: entry.managed_container,
    });
  }
}
