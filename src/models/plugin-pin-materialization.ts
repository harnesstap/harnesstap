import type { SqliteDatabase } from "../db/types.js";
import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type { MaterializationScope } from "../types.js";

function pluginPinMaterializationTableExists(db: SqliteDatabase): boolean {
  try {
    const row = db
      .prepare(
        `SELECT 1 as ok FROM sqlite_master
         WHERE type = 'table' AND name = 'plugin_pin_materializations'
         LIMIT 1`,
      )
      .get() as { ok: number } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

export interface PluginPinMaterialization {
  id: string;
  scope: MaterializationScope;
  root_path: string;
  relative_path: string;
  origin_ref: string;
  resource_type: string;
  resource_name: string;
  plugin_pin_resource_id: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function upsertPluginPinMaterialization(input: {
  scope: MaterializationScope;
  root_path: string;
  relative_path: string;
  origin_ref: string;
  resource_type: string;
  resource_name: string;
  plugin_pin_resource_id?: string | null;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  const relative = normalizeRelativePath(input.relative_path);
  const existing = db
    .prepare(
      `SELECT id FROM plugin_pin_materializations
       WHERE scope = ? AND root_path = ? AND relative_path = ?`,
    )
    .get(input.scope, input.root_path, relative) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE plugin_pin_materializations
       SET origin_ref = ?,
           resource_type = ?,
           resource_name = ?,
           plugin_pin_resource_id = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.origin_ref,
      input.resource_type,
      input.resource_name,
      input.plugin_pin_resource_id ?? null,
      now,
      existing.id,
    );
    return;
  }

  const id = ulid();
  db.prepare(
    `INSERT INTO plugin_pin_materializations (
      id, scope, root_path, relative_path, origin_ref,
      resource_type, resource_name, plugin_pin_resource_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.scope,
    input.root_path,
    relative,
    input.origin_ref,
    input.resource_type,
    input.resource_name,
    input.plugin_pin_resource_id ?? null,
    now,
    now,
  );
}

function relativePathCandidates(
  resource: { type: string; name: string; source?: string },
): string[] {
  const source = resource.source?.trim();
  if (!source) {
    return [];
  }
  const configured = source.startsWith("~/")
    ? source.slice(2)
    : source;
  const relative = normalizeRelativePath(configured);
  const candidates = [relative];
  if (resource.type === "skill" && relative.endsWith("/SKILL.md")) {
    candidates.push(dirnameSkillDir(relative));
  }
  return candidates;
}

function dirnameSkillDir(skillMdPath: string): string {
  const normalized = skillMdPath.replace(/\\/g, "/");
  if (!normalized.endsWith("/SKILL.md")) {
    return normalized;
  }
  return normalized.slice(0, -"/SKILL.md".length);
}

export function matchesPluginPinMaterialization(
  rootPath: string,
  resource: { type: string; name: string; source?: string },
): boolean {
  const paths = relativePathCandidates(resource);
  if (paths.length === 0) {
    return false;
  }
  const expanded = new Set<string>();
  for (const relative of paths) {
    expanded.add(relative);
    if (relative.endsWith("/SKILL.md")) {
      expanded.add(dirnameSkillDir(relative));
    } else if (resource.type === "skill") {
      expanded.add(`${relative}/SKILL.md`);
    }
  }
  try {
    const db = getDb();
    if (!pluginPinMaterializationTableExists(db)) {
      return false;
    }
    for (const relative of expanded) {
      const row = db
        .prepare(
          `SELECT 1 as ok FROM plugin_pin_materializations
           WHERE root_path = ?
             AND relative_path = ?
             AND resource_type = ?
             AND resource_name = ?
           LIMIT 1`,
        )
        .get(rootPath, relative, resource.type, resource.name) as
        | { ok: number }
        | undefined;
      if (row !== undefined) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function findPluginPinResourceIdByOriginRef(
  originRef: string,
): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM resources
       WHERE type = 'plugin'
         AND origin_ref = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(originRef) as { id: string } | undefined;
  return row?.id ?? null;
}
