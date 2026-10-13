import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb, getHarnesstapDir } from "../db/connection.js";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface PluginDataDirResult {
  path: string;
  /** True when this call created the directory and recorded ownership. */
  created: boolean;
  /** Set when an existing directory or file is not ours. Nothing is deleted. */
  warning?: string;
}

export function pluginDataDirPath(pluginName: string): string {
  const safe = pluginName.trim();
  if (!SAFE_NAME.test(safe)) {
    throw new Error(
      `plugin name "${pluginName}" cannot be used as a plugin data directory`,
    );
  }
  return join(getHarnesstapDir(), "plugin-data", safe);
}

/**
 * Create `~/.harnesstap/plugin-data/<plugin>` when it is missing and record
 * that HarnessTap owns it. An existing directory with no ownership row is
 * left in place and not claimed. A path that is not a directory is not replaced.
 */
export function ensurePluginDataDir(pluginName: string): PluginDataDirResult {
  const path = pluginDataDirPath(pluginName);
  const db = getDb();
  const row = db
    .prepare("SELECT path FROM plugin_data_dirs WHERE plugin_name = ?")
    .get(pluginName.trim()) as { path: string } | undefined;

  if (existsSync(path)) {
    const stat = statSync(path);
    if (!stat.isDirectory()) {
      return {
        path,
        created: false,
        warning: `plugin data path ${path} exists and is not a directory. It was left in place.`,
      };
    }
    if (!row) {
      return {
        path,
        created: false,
        warning: `plugin data directory ${path} already exists and is not owned by HarnessTap. It was left in place.`,
      };
    }
    return { path, created: false };
  }

  mkdirSync(path, { recursive: true });
  if (!row) {
    db.prepare(
      "INSERT INTO plugin_data_dirs (plugin_name, path, created_at) VALUES (?, ?, ?)",
    ).run(pluginName.trim(), path, new Date().toISOString());
  }
  return { path, created: true };
}
