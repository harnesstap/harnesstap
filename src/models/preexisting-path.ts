import { ulid } from "ulid";
import { getDb } from "../db/connection.js";

interface PreexistingPathRow {
  id: string;
  root_path: string;
  path: string;
  content_hash: string;
  created_at: string;
}

export interface PreexistingPath {
  id: string;
  root_path: string;
  path: string;
  content_hash: string;
  created_at: string;
}

export function recordPreexistingPath(input: {
  root_path: string;
  path: string;
  content_hash?: string;
}): PreexistingPath {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT * FROM preexisting_paths
       WHERE root_path = ? AND path = ?`,
    )
    .get(input.root_path, input.path) as PreexistingPathRow | undefined;
  if (existing) {
    if (input.content_hash && input.content_hash !== existing.content_hash) {
      db.prepare(
        `UPDATE preexisting_paths SET content_hash = ? WHERE id = ?`,
      ).run(input.content_hash, existing.id);
      return { ...existing, content_hash: input.content_hash };
    }
    return existing;
  }

  const row: PreexistingPath = {
    id: ulid(),
    root_path: input.root_path,
    path: input.path,
    content_hash: input.content_hash ?? "",
    created_at: now,
  };
  db.prepare(
    `INSERT INTO preexisting_paths (id, root_path, path, content_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, row.root_path, row.path, row.content_hash, row.created_at);
  return row;
}

export function isPreexistingPath(rootPath: string, relativePath: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 as ok FROM preexisting_paths
       WHERE root_path = ? AND path = ? LIMIT 1`,
    )
    .get(rootPath, relativePath) as { ok: number } | undefined;
  return row !== undefined;
}

export function listPreexistingPaths(rootPath: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT path FROM preexisting_paths WHERE root_path = ? ORDER BY path ASC`,
    )
    .all(rootPath) as Array<{ path: string }>;
  return rows.map((row) => row.path);
}
