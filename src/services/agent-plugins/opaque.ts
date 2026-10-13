import { getDb } from "../../db/connection.js";
import { HT_EXTENSION_NAMESPACE } from "./manifest.js";
import type { ApPackageFile, ApPackageFiles } from "./files.js";

const OURS = new Set([
  "plugin.json",
  "mcp.json",
  "skills",
  "agents",
  "commands",
  "hooks",
  "hooks.json",
  HT_EXTENSION_NAMESPACE,
]);

export interface OpaquePackage {
  extensions: Record<string, unknown>;
  files: ApPackageFiles;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extension objects other than com.harnesstap, and their on-disk trees. */
export function collectOpaquePackage(
  files: ApPackageFiles,
  extensions: unknown,
): OpaquePackage {
  const foreign: Record<string, unknown> = {};
  if (isRecord(extensions)) {
    for (const [key, value] of Object.entries(extensions)) {
      if (key === HT_EXTENSION_NAMESPACE) continue;
      if (!isRecord(value)) continue;
      foreign[key] = value;
    }
  }
  const keys = new Set(Object.keys(foreign));
  const opaqueFiles: ApPackageFiles = {};
  for (const [relativePath, entry] of Object.entries(files)) {
    const head = relativePath.split("/")[0] ?? "";
    if (!head || OURS.has(head)) continue;
    if (keys.has(head) || head.includes(".")) {
      opaqueFiles[relativePath] = entry;
    }
  }
  return { extensions: foreign, files: opaqueFiles };
}

export function replaceOpaqueFiles(pluginId: string, files: ApPackageFiles): void {
  const db = getDb();
  db.prepare("DELETE FROM plugin_opaque_files WHERE plugin_id = ?").run(pluginId);
  const insert = db.prepare(
    `INSERT INTO plugin_opaque_files (plugin_id, relative_path, encoding, content)
     VALUES (?, ?, ?, ?)`,
  );
  for (const relativePath of Object.keys(files).sort()) {
    const entry = files[relativePath];
    if (!entry) continue;
    insert.run(pluginId, relativePath, entry.encoding, entry.content);
  }
}

export function readOpaqueFiles(pluginId: string): ApPackageFiles {
  const rows = getDb()
    .prepare(
      `SELECT relative_path, encoding, content
       FROM plugin_opaque_files
       WHERE plugin_id = ?
       ORDER BY relative_path`,
    )
    .all(pluginId) as Array<{ relative_path: string; encoding: string; content: string }>;
  const files: ApPackageFiles = {};
  for (const row of rows) {
    const encoding: ApPackageFile["encoding"] = row.encoding === "base64" ? "base64" : "utf8";
    files[row.relative_path] = { encoding, content: row.content };
  }
  return files;
}
