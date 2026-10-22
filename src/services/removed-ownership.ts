import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import {
  listMaterializationsForRootPath,
  recordResourceMaterialization,
} from "../models/resource-materialization.js";
import type { ResourceMaterialization } from "../types.js";

/**
 * The ownership rows of files an apply removed, kept next to the apply's
 * backup (`<harnesstap>/cache/removed-ownership/<snapshot>.json`). A revert
 * that restores those files puts the rows back, so the restored files are
 * HarnessTap's again instead of "not made by HarnessTap".
 */
const KEEP = 50;

type SavedRow = Omit<ResourceMaterialization, "id" | "created_at" | "updated_at">;

function ownershipDir(): string {
  return join(getHarnesstapDir(), "cache", "removed-ownership");
}

function ownershipFile(snapshotId: string): string | undefined {
  if (!/^[0-9A-Za-z_-]+$/.test(snapshotId)) return undefined;
  return join(ownershipDir(), `${snapshotId}.json`);
}

function readSaved(path: string): SavedRow[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedRow[]) : [];
  } catch {
    return [];
  }
}

function prune(): void {
  let entries: Array<{ full: string; mtime: number }>;
  try {
    entries = readdirSync(ownershipDir()).map((name) => {
      const full = join(ownershipDir(), name);
      return { full, mtime: statSync(full).mtimeMs };
    });
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  for (const extra of entries.slice(KEEP)) rmSync(extra.full, { force: true });
}

/** Save the ownership rows of `relativePaths` before an apply removes them. */
export function saveRemovedOwnership(
  snapshotId: string | null | undefined,
  rootPath: string,
  relativePaths: readonly string[],
): void {
  if (!snapshotId || relativePaths.length === 0) return;
  const file = ownershipFile(snapshotId);
  if (!file) return;
  const rows: SavedRow[] = [];
  for (const path of relativePaths) {
    for (const row of listMaterializationsForRootPath(rootPath, path)) {
      const { id: _id, created_at: _created, updated_at: _updated, ...saved } = row;
      rows.push(saved);
    }
  }
  if (rows.length === 0) return;
  try {
    mkdirSync(ownershipDir(), { recursive: true });
    writeFileSync(file, `${JSON.stringify([...readSaved(file), ...rows], null, 2)}\n`);
    prune();
  } catch {
    // Best effort: without it a revert restores the files, unowned.
  }
}

/**
 * After a revert restored `restoredPaths`, put back the ownership rows the
 * apply removed, for each file whose bytes are again what HarnessTap wrote.
 */
export function restoreRemovedOwnership(input: {
  snapshotId: string;
  rootPath: string;
  restoredPaths: readonly string[];
  hashOf: (fullPath: string) => string | undefined;
  /**
   * Shared configs (settings.json, installed_plugins.json) are merged key by
   * key: a row there owns HarnessTap's keys, not the whole file's bytes.
   */
  isMergedConfig?: (relativePath: string) => boolean;
}): number {
  const file = ownershipFile(input.snapshotId);
  if (!file || !existsSync(file)) return 0;
  const restored = new Set(input.restoredPaths);
  let count = 0;
  for (const row of readSaved(file)) {
    if (!restored.has(row.path) || resolve(row.root_path) !== resolve(input.rootPath)) continue;
    const merged = input.isMergedConfig?.(row.path) === true;
    if (!merged && input.hashOf(resolve(input.rootPath, row.path)) !== row.generated_hash) continue;
    try {
      recordResourceMaterialization(row);
      count += 1;
    } catch {
      // The resource is gone from the library: the file stays unowned.
    }
  }
  return count;
}
