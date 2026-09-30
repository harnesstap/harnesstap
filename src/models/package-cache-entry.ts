import { getDb } from "../db/connection.js";
import { ulid } from "ulid";

export type PackageCacheKind = "host_plugin" | "apm_git";

export interface PackageCacheEntry {
  id: string;
  kind: PackageCacheKind;
  resource_id: string | null;
  origin_ref: string;
  resolved_key: string;
  relative_path: string;
  content_fingerprint: string;
  created_at: string;
  updated_at: string;
}

interface PackageCacheEntryRow {
  id: string;
  kind: PackageCacheKind;
  resource_id: string | null;
  origin_ref: string;
  resolved_key: string;
  relative_path: string;
  content_fingerprint: string;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: PackageCacheEntryRow): PackageCacheEntry {
  return row;
}

export function upsertPackageCacheEntry(input: {
  kind: PackageCacheKind;
  origin_ref: string;
  resolved_key: string;
  relative_path: string;
  resource_id?: string | null;
  content_fingerprint?: string;
}): PackageCacheEntry {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id FROM package_cache_entries
       WHERE kind = ? AND origin_ref = ? AND resolved_key = ?`,
    )
    .get(input.kind, input.origin_ref, input.resolved_key) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE package_cache_entries
       SET relative_path = ?,
           resource_id = ?,
           content_fingerprint = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.relative_path,
      input.resource_id ?? null,
      input.content_fingerprint ?? "",
      now,
      existing.id,
    );
    const row = db
      .prepare("SELECT * FROM package_cache_entries WHERE id = ?")
      .get(existing.id) as PackageCacheEntryRow;
    return rowToEntry(row);
  }

  const id = ulid();
  db.prepare(
    `INSERT INTO package_cache_entries (
      id, kind, resource_id, origin_ref, resolved_key, relative_path,
      content_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.kind,
    input.resource_id ?? null,
    input.origin_ref,
    input.resolved_key,
    input.relative_path,
    input.content_fingerprint ?? "",
    now,
    now,
  );

  const row = db
    .prepare("SELECT * FROM package_cache_entries WHERE id = ?")
    .get(id) as PackageCacheEntryRow;
  return rowToEntry(row);
}

export function findPackageCacheEntry(input: {
  kind: PackageCacheKind;
  origin_ref: string;
  resolved_key: string;
}): PackageCacheEntry | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM package_cache_entries
       WHERE kind = ? AND origin_ref = ? AND resolved_key = ?`,
    )
    .get(input.kind, input.origin_ref, input.resolved_key) as
    | PackageCacheEntryRow
    | undefined;
  return row ? rowToEntry(row) : undefined;
}
