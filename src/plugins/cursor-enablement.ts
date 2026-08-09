import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { cursorProjectsMcpsRoot } from "./refresh.js";

const require = createRequire(import.meta.url);

export interface CursorEnablementSignals {
  /** Plugin names correlated as active in Cursor (not marketplace refs). */
  pluginNames: Set<string>;
}

export type CollectCursorEnablementSignals = (
  homeRoot: string,
) => CursorEnablementSignals;

/** Parse `plugin-<name>-...` MCP folder names into plugin names. */
export function pluginNamesFromMcpFolders(
  folderNames: readonly string[],
): Set<string> {
  const names = new Set<string>();
  for (const folder of folderNames) {
    if (!folder.startsWith("plugin-")) continue;
    const rest = folder.slice("plugin-".length);
    if (!rest) continue;
    // Cursor uses plugin-<name>-<name> for many marketplace MCP plugins.
    const parts = rest.split("-");
    if (parts.length >= 2 && parts.length % 2 === 0) {
      const half = parts.length / 2;
      const left = parts.slice(0, half).join("-");
      const right = parts.slice(half).join("-");
      if (left === right) {
        names.add(left);
        continue;
      }
    }
    names.add(rest);
  }
  return names;
}

/**
 * Extract plugin names from Cursor skill path identifiers such as
 * `cache/cursor-public/superpowers/<sha>/skills/...`.
 */
export function pluginNamesFromSkillPaths(
  paths: readonly string[],
): Set<string> {
  const names = new Set<string>();
  for (const path of paths) {
    const normalized = path.replaceAll("\\", "/");
    const cacheMatch = normalized.match(/(?:^|\/)cache\/[^/]+\/([^/]+)\//);
    if (cacheMatch?.[1]) {
      names.add(cacheMatch[1]);
    }
  }
  return names;
}

function listMcpPluginFolderNames(homeRoot: string): string[] {
  const root = cursorProjectsMcpsRoot(homeRoot);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("plugin-"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function resolveCursorStateDbPath(): string {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(
    homedir(),
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

interface SqliteLike {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => { value?: unknown } | undefined;
  };
  close: () => void;
}

function openReadonlySqlite(dbPath: string): SqliteLike | null {
  try {
    if ("Bun" in globalThis) {
      const { Database } = require("bun:sqlite") as {
        Database: new (
          path: string,
          opts?: { readonly?: boolean },
        ) => SqliteLike;
      };
      return new Database(dbPath, { readonly: true });
    }
    const BetterSqlite = require("better-sqlite3") as (
      path: string,
      opts?: { readonly?: boolean },
    ) => SqliteLike;
    return BetterSqlite(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

function readRecentlyUsedSkillPaths(): string[] {
  const dbPath = resolveCursorStateDbPath();
  if (!existsSync(dbPath)) return [];

  const db = openReadonlySqlite(dbPath);
  if (!db) return [];

  try {
    const row = db
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get("cursor.recentlyUsed.globalOrder");
    if (!row?.value) return [];
    const raw =
      typeof row.value === "string"
        ? row.value
        : Buffer.from(row.value as Uint8Array).toString("utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const paths: string[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        "identifier" in entry &&
        typeof (entry as { identifier: unknown }).identifier === "string"
      ) {
        paths.push((entry as { identifier: string }).identifier);
      }
    }
    return paths;
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
  }
}

/** Default enablement collector: MCP folders under home + host recently-used skills. */
export function collectCursorEnablementSignals(
  homeRoot: string,
): CursorEnablementSignals {
  const pluginNames = new Set<string>();
  for (const name of pluginNamesFromMcpFolders(
    listMcpPluginFolderNames(homeRoot),
  )) {
    pluginNames.add(name);
  }
  // recentlyUsed lives in the real Cursor app data dir, not under fixture homes.
  if (homeRoot === homedir()) {
    for (const name of pluginNamesFromSkillPaths(readRecentlyUsedSkillPaths())) {
      pluginNames.add(name);
    }
  }
  return { pluginNames };
}
