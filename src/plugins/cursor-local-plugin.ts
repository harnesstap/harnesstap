import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SerializedFile } from "../types.js";

export const CURSOR_LOCAL_PLUGIN_SCHEMA = "urn:harnesstap:cursor-local-plugin:v1";
export const CURSOR_LOCAL_PLUGIN_SIDECAR = ".harnesstap-plugin.json";
export const CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT = ".cursor/plugins/local";

export interface CursorLocalPluginSidecar {
  schema: typeof CURSOR_LOCAL_PLUGIN_SCHEMA;
  origin_ref: string;
}

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

