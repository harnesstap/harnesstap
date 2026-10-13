import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ulid } from "ulid";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { recordApplyRemovalBackup } from "../../models/apply-removal-backup.js";
import { applyTrashRoot } from "../safe-file-removal.js";
import type { ApPackageFile, ApPackageFiles } from "./files.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface PluginInstallIdentity {
  name: string;
  version: string;
}

export interface PluginInstallResult {
  path: string;
  warnings: string[];
  backedUp: string[];
}

interface InstallRow {
  relative_path: string;
  content_hash: string;
}

function pathSegment(value: string): string {
  const trimmed = value.trim();
  if (SAFE_SEGMENT.test(trimmed)) return trimmed;
  let replaced = trimmed.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+/, "");
  if (!/^[A-Za-z0-9]/.test(replaced)) replaced = `p${replaced}`;
  replaced = replaced.slice(0, 128);
  if (!SAFE_SEGMENT.test(replaced)) return "plugin";
  return replaced;
}

export function pluginInstallRootPath(pluginName: string, version: string): string {
  return join(
    getHarnesstapDir(),
    "cache",
    "agent-plugins",
    pathSegment(pluginName),
    pathSegment(version),
  );
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileBytes(entry: ApPackageFile): Buffer {
  return entry.encoding === "base64"
    ? Buffer.from(entry.content, "base64")
    : Buffer.from(entry.content, "utf8");
}

function containedDest(root: string, relativePath: string): string | undefined {
  if (relativePath.includes("\0") || isAbsolute(relativePath)) return undefined;
  const parts = relativePath.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return undefined;
  }
  const dest = resolve(root, ...parts);
  const rel = relative(root, dest);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return dest;
}

function listInstallRows(pluginName: string, version: string): InstallRow[] {
  return getDb()
    .prepare(
      `SELECT relative_path, content_hash
       FROM plugin_install_files
       WHERE plugin_name = ? AND plugin_version = ?
       ORDER BY relative_path`,
    )
    .all(pluginName, version) as InstallRow[];
}

function upsertInstallRow(
  pluginName: string,
  version: string,
  relativePath: string,
  contentHash: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO plugin_install_files (plugin_name, plugin_version, relative_path, content_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (plugin_name, plugin_version, relative_path)
       DO UPDATE SET content_hash = excluded.content_hash`,
    )
    .run(pluginName, version, relativePath, contentHash);
}

function deleteInstallRow(pluginName: string, version: string, relativePath: string): void {
  getDb()
    .prepare(
      `DELETE FROM plugin_install_files
       WHERE plugin_name = ? AND plugin_version = ? AND relative_path = ?`,
    )
    .run(pluginName, version, relativePath);
}

function backupFile(root: string, relativePath: string, applyId: string): void {
  const fullPath = resolve(root, ...relativePath.split("/"));
  const bytes = readFileSync(fullPath);
  let mode = 0;
  try {
    mode = lstatSync(fullPath).mode;
  } catch {
    mode = 0;
  }
  recordApplyRemovalBackup({
    apply_id: applyId,
    relative_path: relativePath,
    content: bytes,
    mode,
  });
  const dest = join(applyTrashRoot(), applyId, ...relativePath.split("/"));
  mkdirSync(resolve(dest, ".."), { recursive: true });
  writeFileSync(dest, bytes);
}

function writeOwnedFile(dest: string, relativePath: string, bytes: Buffer): void {
  mkdirSync(resolve(dest, ".."), { recursive: true });
  const mode = relativePath.startsWith("bin/") ? 0o755 : 0o644;
  writeFileSync(dest, bytes, { mode });
  if (relativePath.startsWith("bin/")) {
    chmodSync(dest, 0o755);
  }
}

/**
 * Copy an Agent Plugins package into an owned cache directory.
 * An existing file with no ownership row, or one whose bytes no longer match
 * the hash HarnessTap recorded, is left in place. Owned replacements and
 * removals are backed up first.
 */
export function installAgentPluginPackage(
  plugin: PluginInstallIdentity,
  files: ApPackageFiles,
): PluginInstallResult {
  const root = pluginInstallRootPath(plugin.name, plugin.version);
  const warnings: string[] = [];
  const backedUp: string[] = [];
  if (existsSync(root) && !lstatSync(root).isDirectory()) {
    warnings.push(
      `plugin install path ${root} exists and is not a directory. It was left in place.`,
    );
    return { path: root, warnings, backedUp };
  }
  mkdirSync(root, { recursive: true });

  const applyId = `plugin-install-${ulid()}`;
  const owned = new Map(listInstallRows(plugin.name, plugin.version).map((row) => [row.relative_path, row]));
  const nextPaths = new Set<string>();

  for (const relativePath of Object.keys(files).sort()) {
    const entry = files[relativePath];
    if (!entry) continue;
    const dest = containedDest(root, relativePath);
    if (!dest) {
      warnings.push(`plugin file "${relativePath}" is not a path inside the install directory. It was skipped.`);
      continue;
    }
    nextPaths.add(relativePath);
    const bytes = fileBytes(entry);
    const nextHash = hashBytes(bytes);
    if (!existsSync(dest)) {
      writeOwnedFile(dest, relativePath, bytes);
      upsertInstallRow(plugin.name, plugin.version, relativePath, nextHash);
      continue;
    }
    const stat = lstatSync(dest);
    if (!stat.isFile()) {
      warnings.push(`plugin file ${dest} exists and is not a file. It was left in place.`);
      continue;
    }
    const diskHash = hashBytes(readFileSync(dest));
    const row = owned.get(relativePath);
    if (!row) {
      warnings.push(`plugin file ${dest} already exists and is not owned by HarnessTap. It was left in place.`);
      continue;
    }
    if (row.content_hash !== diskHash) {
      warnings.push(`plugin file ${dest} was changed after HarnessTap wrote it. It was left in place.`);
      continue;
    }
    if (diskHash === nextHash) continue;
    backupFile(root, relativePath, applyId);
    backedUp.push(relativePath);
    writeOwnedFile(dest, relativePath, bytes);
    upsertInstallRow(plugin.name, plugin.version, relativePath, nextHash);
  }

  for (const [relativePath, row] of owned) {
    if (nextPaths.has(relativePath)) continue;
    const dest = containedDest(root, relativePath);
    if (!dest || !existsSync(dest)) {
      deleteInstallRow(plugin.name, plugin.version, relativePath);
      continue;
    }
    const stat = lstatSync(dest);
    if (!stat.isFile()) {
      warnings.push(`plugin file ${dest} is no longer in the package and is not a file. It was left in place.`);
      continue;
    }
    const diskHash = hashBytes(readFileSync(dest));
    if (diskHash !== row.content_hash) {
      warnings.push(
        `plugin file ${dest} is no longer in the package and was changed after HarnessTap wrote it. It was left in place.`,
      );
      continue;
    }
    backupFile(root, relativePath, applyId);
    backedUp.push(relativePath);
    rmSync(dest, { force: true });
    deleteInstallRow(plugin.name, plugin.version, relativePath);
  }

  return { path: root, warnings, backedUp };
}

/** Owned Agent Plugins cache directory, when this name and version were imported. */
export function recordedPluginInstallRoot(
  pluginName: string,
  version: string,
): string | undefined {
  if (listInstallRows(pluginName, version).length === 0) return undefined;
  const path = pluginInstallRootPath(pluginName, version);
  if (!existsSync(path)) return undefined;
  return path;
}

export function installedPluginForResource(
  resourceId: string,
): (PluginInstallIdentity & { path: string }) | undefined {
  if (!resourceId) return undefined;
  const row = getDb()
    .prepare(
      `SELECT p.name AS name, p.version AS version
       FROM plugins p
       JOIN plugin_resources pr ON pr.plugin_id = p.id
       WHERE pr.resource_id = ?
         AND EXISTS (
           SELECT 1 FROM plugin_install_files f
           WHERE f.plugin_name = p.name AND f.plugin_version = p.version
         )
       ORDER BY p.updated_at DESC
       LIMIT 1`,
    )
    .get(resourceId) as { name: string; version: string } | undefined;
  if (!row) return undefined;
  return { name: row.name, version: row.version, path: pluginInstallRootPath(row.name, row.version) };
}
