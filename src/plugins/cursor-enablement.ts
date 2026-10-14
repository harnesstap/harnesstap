import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePluginRef } from "./host-plugin-manifest.js";
import { cursorProjectsMcpsRoot } from "./refresh.js";

export interface CursorEnablementSignals {
  /** Plugin names Cursor treats as installed (not marketplace refs). */
  pluginNames: Set<string>;
}

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

/**
 * Plugin name encoded in a Cursor MCP folder.
 * `plugin-<name>-<name>` and `plugin-<name>-plugin-<name>` both name `<name>`.
 */
export function pluginNameFromMcpFolder(folder: string): string | null {
  if (!folder.startsWith("plugin-")) return null;
  const rest = folder.slice("plugin-".length);
  if (!rest) return null;
  const infix = "-plugin-";
  const infixAt = rest.lastIndexOf(infix);
  if (infixAt > 0) {
    const left = rest.slice(0, infixAt);
    const right = rest.slice(infixAt + infix.length);
    if (left.length > 0 && left === right) return left;
  }
  for (let index = 1; index < rest.length - 1; index += 1) {
    if (rest[index] !== "-") continue;
    const left = rest.slice(0, index);
    const right = rest.slice(index + 1);
    if (left === right) return left;
  }
  return rest;
}

/** Parse `plugin-<name>-...` MCP folder names into plugin names. */
export function pluginNamesFromMcpFolders(
  folderNames: readonly string[],
): Set<string> {
  const names = new Set<string>();
  for (const folder of folderNames) {
    const name = pluginNameFromMcpFolder(folder);
    if (name) names.add(name);
  }
  return names;
}

const MCP_FOLDER_MANIFESTS = [
  "SERVER_METADATA.json",
  ".cursor-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  "plugin.json",
] as const;

export interface CursorMcpFolderPlugin {
  name: string;
  ref: string;
}

function pluginRefFromCacheLayout(
  rawPath: string,
): CursorMcpFolderPlugin | null {
  const normalized = rawPath.replaceAll("\\", "/");
  const marker = "/.cursor/plugins/cache/";
  const at = normalized.lastIndexOf(marker);
  if (at < 0) return null;
  const parts = normalized.slice(at + marker.length).split("/").filter((part) => part.length > 0);
  const marketplace = parts[0];
  const name = parts[1];
  if (!marketplace || !name) return null;
  return { name, ref: `${name}@${marketplace}` };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function manifestPluginRef(folderPath: string): CursorMcpFolderPlugin | null {
  for (const relativePath of MCP_FOLDER_MANIFESTS) {
    const parsed = readJsonObject(join(folderPath, relativePath));
    if (!parsed) continue;
    for (const key of ["pluginPath", "installPath", "path", "serverPath"]) {
      const raw = stringField(parsed, key);
      if (!raw) continue;
      const fromCache = pluginRefFromCacheLayout(raw);
      if (fromCache) return fromCache;
    }
    for (const key of ["pluginRef", "ref", "pluginId"]) {
      const raw = stringField(parsed, key);
      if (!raw || !raw.includes("@")) continue;
      const parsedRef = parsePluginRef(raw);
      if (!parsedRef.name) continue;
      return { name: parsedRef.name, ref: raw };
    }
    for (const key of ["pluginName", "plugin", "name"]) {
      const raw = stringField(parsed, key);
      if (!raw || raw.startsWith("plugin-")) continue;
      return { name: raw, ref: `${raw}@cursor` };
    }
  }
  return null;
}

function cacheMatchScore(
  folderName: string,
  pluginName: string,
  marketplace: string,
): number {
  if (!pluginName) return 0;
  if (folderName === `plugin-${pluginName}-plugin-${pluginName}`) return 4;
  if (folderName === `plugin-${pluginName}-${pluginName}`) return 3;
  if (marketplace && folderName === `plugin-${marketplace}-${pluginName}`) return 2;
  if (folderName === `plugin-${pluginName}`) return 1;
  return 0;
}

/**
 * Real plugin ref for a `plugin-*` MCP folder. The folder manifest wins,
 * then a cache directory `~/.cursor/plugins/cache/<marketplace>/<plugin>/<sha>`
 * whose name matches the folder, then the folder name itself.
 */
export function resolveCursorMcpFolderPlugin(
  homeRoot: string,
  folderName: string,
  cached: readonly { name: string; ref: string }[],
): CursorMcpFolderPlugin | null {
  if (!folderName.startsWith("plugin-")) return null;
  const fromManifest = manifestPluginRef(
    join(cursorProjectsMcpsRoot(homeRoot), folderName),
  );
  if (fromManifest) return fromManifest;
  let best: CursorMcpFolderPlugin & { score: number } | null = null;
  for (const row of cached) {
    const marketplace = parsePluginRef(row.ref).marketplace;
    const score = cacheMatchScore(folderName, row.name, marketplace);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { name: row.name, ref: row.ref, score };
    }
  }
  if (best) return { name: best.name, ref: best.ref };
  const name = pluginNameFromMcpFolder(folderName);
  if (!name) return null;
  return { name, ref: `${name}@cursor` };
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

function resolveCursorUserSettingsPath(homeRoot: string): string {
  return join(cursorUserDataDir(homeRoot), "User", "settings.json");
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
 * imported plugins/skills). Read from Cursor `settings.json` only. Default
 * is on. An explicit false means HarnessTap must not attribute those trees
 * to the Cursor harness.
 */
export function cursorLoadsForeignHarnessTrees(homeRoot: string): boolean {
  const fromSettings = thirdPartyFlagFromSettings(readCursorUserSettings(homeRoot));
  if (fromSettings !== null) {
    return fromSettings;
  }
  return true;
}

/**
 * Names from Cursor MCP folders and install JSON. Status does not read
 * `state.vscdb`. A cache directory counts as installed on its own.
 */
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
  return { pluginNames };
}
