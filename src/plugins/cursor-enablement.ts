import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePluginRef } from "./host-plugin-manifest.js";
import { cursorProjectsMcpsRoot } from "./refresh.js";

const require = createRequire(import.meta.url);

export interface CursorEnablementSignals {
  /** Plugin names Cursor treats as installed (not marketplace refs). */
  pluginNames: Set<string>;
}

export type CollectCursorEnablementSignals = (
  homeRoot: string,
) => CursorEnablementSignals;

const THIRD_PARTY_SETTING_KEYS = [
  "cursor.thirdPartyExtensibility",
  "cursor.agent.thirdPartyExtensibility",
  "cursor.skills.includeThirdParty",
  "cursor.skills.includeThirdPartyPlugins",
  "cursor.composer.includeThirdPartyPlugins",
  "cursor.enableThirdPartySkills",
  "cursor.general.includeThirdPartyPlugins",
] as const;

const INSTALLED_PLUGIN_JSON_FILES = [
  join(".cursor", "plugins", "installed.json"),
  join(".cursor", "plugins", "installed_plugins.json"),
] as const;

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

export function pluginNameFromStoredId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^[0-9]+$/.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replaceAll("\\", "/");
  if (
    normalized.includes("/") ||
    normalized.startsWith("~") ||
    normalized.startsWith("cache/")
  ) {
    return [...pluginNamesFromSkillPaths([normalized])][0] ?? null;
  }
  const dotted = trimmed.split(".").filter((part) => part.length > 0);
  const last = dotted[dotted.length - 1];
  if (!last || /^[0-9]+$/.test(last)) {
    return null;
  }
  return parsePluginRef(last.includes("@") ? last : `${last}@local`).name;
}

export function pluginNamesFromStoredValue(value: unknown): Set<string> {
  const names = new Set<string>();
  collectPluginNamesFromUnknown(value, names, true);
  return names;
}

function collectPluginNamesFromUnknown(
  value: unknown,
  names: Set<string>,
  fromArray: boolean,
): void {
  if (typeof value === "string") {
    if (fromArray) {
      const name = pluginNameFromStoredId(value);
      if (name) names.add(name);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPluginNamesFromUnknown(item, names, true);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["name", "pluginName", "plugin", "slug", "id"]) {
    const field = record[key];
    if (typeof field === "string") {
      const name = pluginNameFromStoredId(field);
      if (name) names.add(name);
    }
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      collectPluginNamesFromUnknown(nested, names, false);
    }
  }
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

/**
 * Cursor-native plugin MCP identities (e.g. `plugin-slack-slack` → `slack`).
 * These are host-provided; HarnessTap should not treat them as missing installs.
 */
export function listCursorNativeMcpPluginNames(homeRoot: string): Set<string> {
  return pluginNamesFromMcpFolders(listMcpPluginFolderNames(homeRoot));
}

export function cursorUserDataDir(homeRoot: string): string {
  if (homeRoot !== homedir()) {
    return join(homeRoot, ".config", "Cursor");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Cursor");
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Cursor");
  }
  return join(homedir(), ".config", "Cursor");
}

function resolveCursorStateDbPath(homeRoot: string): string {
  return join(cursorUserDataDir(homeRoot), "User", "globalStorage", "state.vscdb");
}

function resolveCursorUserSettingsPath(homeRoot: string): string {
  return join(cursorUserDataDir(homeRoot), "User", "settings.json");
}

interface SqliteLike {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => { value?: unknown } | undefined;
    all: (...params: unknown[]) => Array<{ key?: unknown; value?: unknown }>;
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

function decodeSqliteValue(value: unknown): unknown {
  if (value == null) return null;
  const raw =
    typeof value === "string"
      ? value
      : Buffer.from(value as Uint8Array).toString("utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function readCursorItemTableRows(
  homeRoot: string,
  keyPrefix: string,
): Array<{ key: string; value: unknown }> {
  const dbPath = resolveCursorStateDbPath(homeRoot);
  if (!existsSync(dbPath)) return [];

  const db = openReadonlySqlite(dbPath);
  if (!db) return [];

  try {
    const rows = db
      .prepare("SELECT key, value FROM ItemTable WHERE key LIKE ?")
      .all(`${keyPrefix}%`);
    const parsed: Array<{ key: string; value: unknown }> = [];
    for (const row of rows) {
      if (typeof row.key !== "string" || !row.key) continue;
      parsed.push({ key: row.key, value: decodeSqliteValue(row.value) });
    }
    return parsed;
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

function readRecentlyUsedSkillPaths(homeRoot: string): string[] {
  const rows = readCursorItemTableRows(homeRoot, "cursor.recentlyUsed.globalOrder");
  const exact = rows.find((row) => row.key === "cursor.recentlyUsed.globalOrder");
  if (!Array.isArray(exact?.value)) return [];
  const paths: string[] = [];
  for (const entry of exact.value) {
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
}

function pluginNamesFromVscdb(homeRoot: string): Set<string> {
  const names = new Set<string>();
  for (const row of readCursorItemTableRows(homeRoot, "cursor.plugins")) {
    for (const name of pluginNamesFromStoredValue(row.value)) {
      names.add(name);
    }
  }
  return names;
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function pluginNamesFromInstalledPluginFile(
  document: unknown,
): Set<string> {
  const names = new Set<string>();
  if (Array.isArray(document)) {
    return pluginNamesFromStoredValue(document);
  }
  if (!document || typeof document !== "object") {
    return names;
  }
  const record = document as Record<string, unknown>;
  if (record.plugins && typeof record.plugins === "object") {
    if (Array.isArray(record.plugins)) {
      return pluginNamesFromStoredValue(record.plugins);
    }
    for (const ref of Object.keys(record.plugins as Record<string, unknown>)) {
      const name = pluginNameFromStoredId(ref);
      if (name) names.add(name);
    }
  }
  for (const name of pluginNamesFromStoredValue(record)) {
    names.add(name);
  }
  return names;
}

function pluginNamesFromInstalledJsonFiles(homeRoot: string): Set<string> {
  const names = new Set<string>();
  for (const relative of INSTALLED_PLUGIN_JSON_FILES) {
    const path = join(homeRoot, relative);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      for (const name of pluginNamesFromInstalledPluginFile(parsed)) {
        names.add(name);
      }
    } catch {
      // ignore malformed install records
    }
  }
  return names;
}

function isThirdPartySettingsKey(key: string): boolean {
  if ((THIRD_PARTY_SETTING_KEYS as readonly string[]).includes(key)) {
    return true;
  }
  return /third[-_]?party/i.test(key) && /plugin|skill|extensib|config/i.test(key);
}

function thirdPartyFlagFromSettings(
  settings: Record<string, unknown> | null,
): boolean | null {
  if (!settings) return null;
  let sawTrue = false;
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== "boolean" || !isThirdPartySettingsKey(key)) {
      continue;
    }
    if (value === false) {
      return false;
    }
    sawTrue = true;
  }
  if (sawTrue) return true;
  return null;
}

function readCursorUserSettings(homeRoot: string): Record<string, unknown> | null {
  const candidates = [
    resolveCursorUserSettingsPath(homeRoot),
    join(homeRoot, ".cursor", "settings.json"),
    join(homeRoot, ".cursor", "mdm.json"),
    join(homeRoot, ".cursor", "cli-config.json"),
  ];
  for (const path of candidates) {
    const parsed = readJsonObject(path);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Whether Cursor still loads other-harness trees (`.claude`, `.agents` as
 * imported plugins/skills). Default is on; an explicit IDE/settings false
 * means HarnessTap must not attribute those trees to the Cursor harness.
 */
export function cursorLoadsForeignHarnessTrees(homeRoot: string): boolean {
  const fromSettings = thirdPartyFlagFromSettings(readCursorUserSettings(homeRoot));
  if (fromSettings !== null) {
    return fromSettings;
  }
  for (const row of readCursorItemTableRows(homeRoot, "cursor.")) {
    if (typeof row.value !== "boolean" || !isThirdPartySettingsKey(row.key)) {
      continue;
    }
    if (row.value === false) {
      return false;
    }
  }
  return true;
}

/** Default enablement collector: MCP folders, install records, recently-used skills. */
export function collectCursorEnablementSignals(
  homeRoot: string,
): CursorEnablementSignals {
  const pluginNames = new Set<string>();
  for (const name of pluginNamesFromMcpFolders(
    listMcpPluginFolderNames(homeRoot),
  )) {
    pluginNames.add(name);
  }
  for (const name of pluginNamesFromInstalledJsonFiles(homeRoot)) {
    pluginNames.add(name);
  }
  for (const name of pluginNamesFromVscdb(homeRoot)) {
    pluginNames.add(name);
  }
  for (const name of pluginNamesFromSkillPaths(readRecentlyUsedSkillPaths(homeRoot))) {
    pluginNames.add(name);
  }
  return { pluginNames };
}
