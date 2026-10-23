import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import {
  listMaterializationsForRootPath,
  recordResourceMaterialization,
} from "../models/resource-materialization.js";
import type { ResourceMaterialization } from "../types.js";
import {
  readHostPluginViewRecords,
  recordHostPluginViewFiles,
  type HostPluginViewRecord,
} from "./package-cache/host-plugin-views.js";

/**
 * The ownership rows of files an apply removed, kept next to the apply's
 * backup (`<harnesstap>/cache/removed-ownership/<snapshot>.json`). A revert
 * that restores those files puts the rows back, so the restored files are
 * HarnessTap's again instead of "not made by HarnessTap". The records of the
 * host plugin folders (`host-plugin-views.json`) are kept the same way, in
 * `<snapshot>.views.json`: they are what makes a plugin folder HarnessTap's.
 */
const KEEP = 50;

type SavedRow = Omit<ResourceMaterialization, "id" | "created_at" | "updated_at">;

function ownershipDir(): string {
  return join(getHarnesstapDir(), "cache", "removed-ownership");
}

function ownershipFile(snapshotId: string, suffix = ""): string | undefined {
  if (!/^[0-9A-Za-z_-]+$/.test(snapshotId)) return undefined;
  return join(ownershipDir(), `${snapshotId}${suffix}.json`);
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
  const newest = new Map<string, { names: string[]; mtime: number }>();
  try {
    for (const name of readdirSync(ownershipDir())) {
      const stem = name.split(".")[0] ?? name;
      const mtime = statSync(join(ownershipDir(), name)).mtimeMs;
      const entry = newest.get(stem) ?? { names: [], mtime: 0 };
      entry.names.push(name);
      entry.mtime = Math.max(entry.mtime, mtime);
      newest.set(stem, entry);
    }
  } catch {
    return;
  }
  const ordered = [...newest.values()].sort((a, b) => b.mtime - a.mtime);
  for (const extra of ordered.slice(KEEP)) {
    for (const name of extra.names) rmSync(join(ownershipDir(), name), { force: true });
  }
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

interface SavedView {
  view: string;
  record: HostPluginViewRecord;
}

function readSavedViews(path: string): SavedView[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

/**
 * Save the records of the host plugin folders holding `relativePaths`, before
 * an apply removes those files (and so the records). The first save of a
 * folder wins: it is the state before any removal.
 */
export function saveRemovedHostPluginViews(
  snapshotId: string | null | undefined,
  rootPath: string,
  relativePaths: readonly string[],
): void {
  if (!snapshotId || relativePaths.length === 0) return;
  const file = ownershipFile(snapshotId, ".views");
  if (!file) return;
  const records = readHostPluginViewRecords();
  const views = Object.keys(records);
  if (views.length === 0) return;
  const saved = readSavedViews(file);
  const known = new Set(saved.map((entry) => entry.view));
  let added = false;
  for (const path of relativePaths) {
    const target = resolve(rootPath, path);
    const view = views.find((candidate) => target.startsWith(`${candidate}${sep}`));
    const record = view ? records[view] : undefined;
    if (!view || !record || record.legacy || known.has(view)) continue;
    known.add(view);
    saved.push({ view, record });
    added = true;
  }
  if (!added) return;
  try {
    mkdirSync(ownershipDir(), { recursive: true });
    writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
    prune();
  } catch {
    // Best effort: without it the restored folder is the user's.
  }
}

function folderHoldsOnly(dir: string, known: ReadonlySet<string>, base = dir): boolean {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    const full = join(dir, name);
    let isDirectory: boolean;
    try {
      isDirectory = lstatSync(full).isDirectory();
    } catch {
      return false;
    }
    if (isDirectory) {
      if (!folderHoldsOnly(full, known, base)) return false;
    } else if (!known.has(relative(base, full).split(sep).join("/"))) {
      return false;
    }
  }
  return true;
}

/**
 * After a revert restored `restoredPaths`, put back the record of each host
 * plugin folder the apply removed: the restored files whose bytes are again
 * what HarnessTap wrote are HarnessTap's, and the folder is too when nothing
 * else is in it.
 */
export function restoreRemovedHostPluginViews(input: {
  snapshotId: string;
  rootPath: string;
  restoredPaths: readonly string[];
  hashOf: (fullPath: string) => string | undefined;
}): number {
  const file = ownershipFile(input.snapshotId, ".views");
  if (!file || !existsSync(file)) return 0;
  const restored = new Set(input.restoredPaths.map((path) => resolve(input.rootPath, path)));
  let count = 0;
  for (const { view, record } of readSavedViews(file)) {
    const files: Record<string, string> = {};
    for (const [path, hash] of Object.entries(record.files)) {
      const full = resolve(view, path);
      if (restored.has(full) && input.hashOf(full) === hash) files[path] = hash;
    }
    if (Object.keys(files).length === 0) continue;
    const created = record.created && folderHoldsOnly(view, new Set(Object.keys(files)));
    recordHostPluginViewFiles({ hostView: view, created, files });
    count += 1;
  }
  return count;
}
