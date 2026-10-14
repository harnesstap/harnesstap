import { existsSync, readdirSync, readFileSync, statSync, watch, type Dirent, type FSWatcher } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileSignature } from "../services/file-signature.js";
import { computationSlot } from "../services/status-computation.js";
import type { SerializedFile } from "../types.js";
import { cursorUserDataDir } from "./cursor-enablement.js";

export const CURSOR_LOCAL_PLUGIN_SCHEMA = "urn:harnesstap:cursor-local-plugin:v1";
export const CURSOR_LOCAL_PLUGIN_SIDECAR = ".harnesstap-plugin.json";
export const CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT = ".cursor/plugins/local";

export type CursorLocalPluginLoadState =
  | "present"
  | "pending_reload"
  | "loaded"
  | "shadowed"
  | "rejected";

export interface CursorLocalPluginSidecar {
  schema: typeof CURSOR_LOCAL_PLUGIN_SCHEMA;
  origin_ref: string;
}

const LOAD_EVENT_RE = /loadUserLocalPlugin (\S+) (loaded|rejected|failed)/g;

export function sanitizeCursorLocalFolderSegment(value: string): string {
  const cleaned = value.trim().replace(/[\\/]/g, "-").replace(/^\.+/, "");
  return cleaned || "plugin";
}

export function cursorLocalPluginFolderName(
  name: string,
  marketplace: string,
  duplicateName: boolean,
): string {
  const plugin = sanitizeCursorLocalFolderSegment(name);
  if (!duplicateName) {
    return plugin;
  }
  const market = sanitizeCursorLocalFolderSegment(
    marketplace === "" ? "local" : marketplace,
  );
  return `${plugin}--${market}`;
}

export function cursorLocalPluginSidecarDocument(
  originRef: string,
): CursorLocalPluginSidecar {
  return {
    schema: CURSOR_LOCAL_PLUGIN_SCHEMA,
    origin_ref: originRef,
  };
}

export function cursorLocalPluginSidecarContent(originRef: string): string {
  return `${JSON.stringify(cursorLocalPluginSidecarDocument(originRef), null, 2)}\n`;
}

export function readCursorLocalPluginSidecar(
  installPath: string,
): CursorLocalPluginSidecar | null {
  const path = join(installPath, CURSOR_LOCAL_PLUGIN_SIDECAR);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as { schema?: unknown; origin_ref?: unknown };
    if (record.schema !== CURSOR_LOCAL_PLUGIN_SCHEMA) return null;
    if (typeof record.origin_ref !== "string" || !record.origin_ref.includes("@")) {
      return null;
    }
    return {
      schema: CURSOR_LOCAL_PLUGIN_SCHEMA,
      origin_ref: record.origin_ref,
    };
  } catch {
    return null;
  }
}

export function cursorLocalPluginLoadState(input: {
  folderName: string;
  folderMtimeMs: number;
  shadowed: boolean;
  logText: string | null;
  logMtimeMs: number | null;
}): CursorLocalPluginLoadState {
  if (input.shadowed) return "shadowed";
  if (!input.logText) return "present";

  let last: "loaded" | "rejected" | "failed" | null = null;
  for (const match of input.logText.matchAll(LOAD_EVENT_RE)) {
    if (match[1] === input.folderName) {
      const event = match[2];
      if (event === "loaded" || event === "rejected" || event === "failed") {
        last = event;
      }
    }
  }

  if (last === "rejected" || last === "failed") return "rejected";
  if (last === "loaded") {
    if (
      input.logMtimeMs != null &&
      input.folderMtimeMs > input.logMtimeMs
    ) {
      return "pending_reload";
    }
    return "loaded";
  }
  return "present";
}

interface CursorPluginsLog {
  text: string;
  mtimeMs: number;
}

interface CursorPluginsLogFile {
  path: string;
  mtimeMs: number;
}

const PLUGINS_LOG_PREFIX = "Cursor Plugins";
const LOG_WALK_DEPTH = 6;

/**
 * Cursor writes one session directory per launch under `logs/`. The current
 * Plugins log lives in the newest session, so older sessions are not walked.
 */
function newestSessionDirectory(logsDir: string): string | null {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: { path: string; mtimeMs: number; name: string } | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const absolute = join(logsDir, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(absolute).mtimeMs;
    } catch {
      continue;
    }
    if (
      !best
      || mtimeMs > best.mtimeMs
      || (mtimeMs === best.mtimeMs && entry.name > best.name)
    ) {
      best = { path: absolute, mtimeMs, name: entry.name };
    }
  }
  return best?.path ?? null;
}

function newestPluginsLogUnder(
  dir: string,
  depth: number,
): CursorPluginsLogFile | null {
  if (depth > LOG_WALK_DEPTH) return null;
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: CursorPluginsLogFile | null = null;
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = newestPluginsLogUnder(absolute, depth + 1);
      if (nested && (!best || nested.mtimeMs > best.mtimeMs)) {
        best = nested;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.startsWith(PLUGINS_LOG_PREFIX)) continue;
    try {
      const mtimeMs = statSync(absolute).mtimeMs;
      if (!best || mtimeMs > best.mtimeMs) {
        best = { path: absolute, mtimeMs };
      }
    } catch {
      // skip unreadable log files
    }
  }
  return best;
}

interface RememberedPluginsLog {
  sessionName: string;
  logPath: string | null;
  namesKey: string;
}

const rememberedLogs = new Map<string, RememberedPluginsLog>();
const logDirtyHomes = new Set<string>();
const logWatchers = new Map<string, FSWatcher>();
let logWalks = 0;

/** How many times the newest session tree was walked. Tests use this. */
export function readCursorPluginsLogWalkCount(): number {
  return logWalks;
}

function listSessionNames(logsDir: string): string[] {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) names.push(entry.name);
  }
  names.sort();
  return names;
}

function ensureLogsWatcher(homeRoot: string, logsDir: string): void {
  if (logWatchers.has(homeRoot)) return;
  try {
    statSync(logsDir);
  } catch {
    return;
  }
  try {
    let ready = false;
    const watcher = watch(logsDir, { persistent: false }, () => {
      if (!ready) return;
      logDirtyHomes.add(homeRoot);
    });
    watcher.on("error", () => {
      logDirtyHomes.add(homeRoot);
      watcher.close();
      logWatchers.delete(homeRoot);
    });
    setTimeout(() => {
      ready = true;
    }, 0);
    logWatchers.set(homeRoot, watcher);
  } catch {
    logDirtyHomes.add(homeRoot);
  }
}

function rememberedSignature(remembered: RememberedPluginsLog): string {
  if (!remembered.logPath) return `${remembered.sessionName}:none`;
  return `${remembered.sessionName}:${fileSignature(remembered.logPath)}`;
}

/**
 * Session name plus the newest Plugins log stat. After the log path is
 * known, later calls stat that file only, until a new session directory
 * appears. Other files under logs are ignored.
 */
function computeCursorPluginsLogSignature(homeRoot: string): string {
  const logsDir = join(cursorUserDataDir(homeRoot), "logs");
  ensureLogsWatcher(homeRoot, logsDir);
  const remembered = rememberedLogs.get(homeRoot);
  if (remembered && !logDirtyHomes.has(homeRoot)) {
    return rememberedSignature(remembered);
  }

  const namesKey = listSessionNames(logsDir).join("\n");
  logDirtyHomes.delete(homeRoot);
  if (remembered && remembered.namesKey === namesKey) {
    rememberedLogs.set(homeRoot, { ...remembered, namesKey });
    return rememberedSignature(remembered);
  }

  const session = newestSessionDirectory(logsDir);
  if (!session) {
    const stored = { sessionName: "", logPath: null, namesKey };
    rememberedLogs.set(homeRoot, stored);
    return rememberedSignature(stored);
  }
  const sessionName = basename(session);
  if (remembered && remembered.sessionName === sessionName && remembered.logPath) {
    const kept = { sessionName, logPath: remembered.logPath, namesKey };
    rememberedLogs.set(homeRoot, kept);
    return rememberedSignature(kept);
  }

  logWalks += 1;
  const found = newestPluginsLogUnder(session, 0);
  rememberedLogs.set(homeRoot, {
    sessionName,
    logPath: found?.path ?? null,
    namesKey,
  });
  const stored = rememberedLogs.get(homeRoot);
  return stored ? rememberedSignature(stored) : "none";
}

export function findNewestCursorPluginsLog(homeRoot: string): CursorPluginsLogFile | null {
  cursorPluginsLogSignature(homeRoot);
  const remembered = rememberedLogs.get(homeRoot);
  if (!remembered?.logPath) return null;
  try {
    return { path: remembered.logPath, mtimeMs: statSync(remembered.logPath).mtimeMs };
  } catch {
    return null;
  }
}

/** Signature of the newest Cursor Plugins log, for inventory cache checks. */
export function cursorPluginsLogSignature(homeRoot: string): string {
  return computationSlot(`cursor-plugins-log:${homeRoot}`, () =>
    computeCursorPluginsLogSignature(homeRoot),
  );
}

let pluginsLogCache: { sig: string; log: CursorPluginsLog } | null = null;

export function clearCursorPluginsLogCache(): void {
  pluginsLogCache = null;
  rememberedLogs.clear();
  logDirtyHomes.clear();
  for (const watcher of logWatchers.values()) watcher.close();
  logWatchers.clear();
}

/** Latest Cursor plugin loader log under this home's Cursor user data directory. */
export function readCursorLocalPluginLoadLog(
  homeRoot: string,
): CursorPluginsLog | null {
  const newest = findNewestCursorPluginsLog(homeRoot);
  if (!newest) return null;
  const sig = `${newest.path}\0${fileSignature(newest.path)}`;
  if (pluginsLogCache && pluginsLogCache.sig === sig) {
    return { text: pluginsLogCache.log.text, mtimeMs: pluginsLogCache.log.mtimeMs };
  }
  try {
    const log = { text: readFileSync(newest.path, "utf-8"), mtimeMs: newest.mtimeMs };
    pluginsLogCache = { sig, log };
    return { text: log.text, mtimeMs: log.mtimeMs };
  } catch {
    return null;
  }
}

export function findCursorLocalPluginDirectory(
  homeRoot: string,
  originRef: string,
): string | null {
  const root = join(homeRoot, CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT);
  if (!existsSync(root)) return null;
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const installPath = join(root, entry.name);
    const sidecar = readCursorLocalPluginSidecar(installPath);
    if (sidecar?.origin_ref === originRef) return installPath;
  }
  return null;
}

function originRefFromSidecarContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { schema?: unknown; origin_ref?: unknown };
    if (parsed.schema !== CURSOR_LOCAL_PLUGIN_SCHEMA) return null;
    if (typeof parsed.origin_ref !== "string" || !parsed.origin_ref.includes("@")) {
      return null;
    }
    return parsed.origin_ref;
  } catch {
    return null;
  }
}

function cursorLocalPluginFolderFromRelative(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const prefix = `${CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT}/`;
  if (!normalized.startsWith(prefix)) return null;
  const folder = normalized.slice(prefix.length).split("/")[0];
  return folder || null;
}

/**
 * Paths under a HarnessTap-managed Cursor local plugin that this apply no
 * longer emits. Folders without the sidecar in the desired set are left
 * alone. The caller removes returned paths through safe file removal, which
 * skips unmanaged and modified files and backs up owned removals.
 */
export function pruneManagedCursorLocalPlugins(
  rootPath: string,
  files: readonly SerializedFile[],
): string[] {
  const undesired: string[] = [];
  const desiredByFolder = new Map<string, Set<string>>();
  for (const file of files) {
    const folder = cursorLocalPluginFolderFromRelative(file.path);
    if (!folder) continue;
    const desired = desiredByFolder.get(folder) ?? new Set<string>();
    desired.add(file.path.replaceAll("\\", "/"));
    desiredByFolder.set(folder, desired);
  }

  for (const [folder, desired] of desiredByFolder) {
    const sidecarPath = `${CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT}/${folder}/${CURSOR_LOCAL_PLUGIN_SIDECAR}`;
    if (!desired.has(sidecarPath)) continue;
    const sidecar = files.find((file) => file.path.replaceAll("\\", "/") === sidecarPath);
    const originRef = sidecar ? originRefFromSidecarContent(sidecar.content) : null;
    if (originRef) {
      const previous = findCursorLocalPluginDirectory(rootPath, originRef);
      const absoluteNext = join(rootPath, CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT, folder);
      if (previous && previous !== absoluteNext) {
        const previousRelative = relative(rootPath, previous).split(sep).join("/");
        if (previousRelative && !previousRelative.startsWith("..")) {
          collectUndesiredFiles(previous, previousRelative, new Set(), undesired);
        }
      }
    }
    const absoluteFolder = join(rootPath, CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT, folder);
    if (!existsSync(absoluteFolder)) continue;
    collectUndesiredFiles(
      absoluteFolder,
      `${CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT}/${folder}`,
      desired,
      undesired,
    );
  }
  return undesired;
}

function collectUndesiredFiles(
  absoluteDir: string,
  relativeDir: string,
  desired: ReadonlySet<string>,
  undesired: string[],
): void {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = join(absoluteDir, entry.name);
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectUndesiredFiles(absolute, relativePath, desired, undesired);
      continue;
    }
    if (!entry.isFile()) continue;
    if (desired.has(relativePath)) continue;
    undesired.push(relativePath);
  }
}

