import { existsSync, readdirSync, readFileSync, rmSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

function newestLogInTree(dir: string, depth: number): { path: string; mtimeMs: number } | null {
  if (depth > 6 || !existsSync(dir)) return null;
  let best: { path: string; mtimeMs: number } | null = null;
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = newestLogInTree(absolute, depth + 1);
      if (nested && (!best || nested.mtimeMs > best.mtimeMs)) {
        best = nested;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.startsWith("Cursor Plugins")) continue;
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

/** Latest Cursor plugin loader log for the real user home. Fixture homes return null. */
export function readCursorLocalPluginLoadLog(
  homeRoot: string,
): CursorPluginsLog | null {
  if (homeRoot !== homedir()) return null;
  const logsDir = join(cursorUserDataDir(homeRoot), "logs");
  const newest = newestLogInTree(logsDir, 0);
  if (!newest) return null;
  try {
    return { text: readFileSync(newest.path, "utf-8"), mtimeMs: newest.mtimeMs };
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
 * Delete files under a HarnessTap-owned local plugin directory that this
 * apply no longer emits. Folders without the sidecar in the desired set are
 * left alone, including plugins dropped into `plugins/local` by hand.
 */
export function pruneManagedCursorLocalPlugins(
  rootPath: string,
  files: readonly SerializedFile[],
): void {
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
        rmSync(previous, { recursive: true, force: true });
      }
    }
    const absoluteFolder = join(rootPath, CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT, folder);
    if (!existsSync(absoluteFolder)) continue;
    removeUndesiredFiles(absoluteFolder, `${CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT}/${folder}`, desired);
  }
}

function removeUndesiredFiles(
  absoluteDir: string,
  relativeDir: string,
  desired: ReadonlySet<string>,
): void {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = join(absoluteDir, entry.name);
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      removeUndesiredFiles(absolute, relative, desired);
      try {
        if (readdirSync(absolute).length === 0) {
          rmSync(absolute, { recursive: true, force: true });
        }
      } catch {
        // leave a directory that is still in use
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (desired.has(relative)) continue;
    rmSync(absolute, { force: true });
  }
}
