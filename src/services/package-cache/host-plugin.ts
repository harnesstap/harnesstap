import {
  type Dirent,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { getHarnesstapDir } from "../../db/connection.js";
import { parsePluginRef } from "../../plugins/claude-installed.js";
import {
  findPackageCacheEntry,
  upsertPackageCacheEntry,
} from "../../models/package-cache-entry.js";
import { cacheVersionDir } from "../host-plugin-source.js";
import { isPluginInstallRoot } from "../plugin-source-import.js";
import {
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
  hashOnDiskFile,
} from "../safe-file-removal.js";
import {
  type KeptHostPluginViewFiles,
  type KeptHostPluginViewReason,
  hostPluginViewForceReplace,
  recordKeptHostPluginViewFiles,
} from "./host-plugin-view-policy.js";
import {
  readHostPluginViewRecord,
  recordHostPluginViewFiles,
  removeEmptyDirsUnder,
} from "./host-plugin-views.js";
import {
  hostPluginPackageDir,
  hostPluginPackageRelativePath,
} from "./paths.js";

function shouldCopyPackageTreePath(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath).replace(/\\/g, "/");
  if (rel === "" || rel === ".") {
    return true;
  }
  if (rel === ".git" || rel.startsWith(".git/")) {
    return false;
  }
  if (rel === "node_modules" || rel.startsWith("node_modules/")) {
    return false;
  }
  return true;
}

function copyPackageTree(sourceRoot: string, destRoot: string): void {
  cpSync(sourceRoot, destRoot, {
    recursive: true,
    force: true,
    filter: (path) => shouldCopyPackageTreePath(sourceRoot, path),
  });
}

export {
  type KeptHostPluginViewFiles,
  type KeptHostPluginViewReason,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
} from "./host-plugin-view-policy.js";

function listTreeFiles(root: string, filter?: (absolutePath: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (filter && !filter(full)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return files.sort();
}

function sameBytes(left: string, right: string): boolean {
  try {
    return readFileSync(left).equals(readFileSync(right));
  } catch {
    return false;
  }
}

function hostViewFileOwnership(input: {
  homeRoot: string;
  hostView: string;
  path: string;
  recorded: Record<string, string>;
}): "owned" | KeptHostPluginViewReason {
  const absolute = join(input.hostView, input.path);
  const recorded = input.recorded[input.path];
  if (recorded) {
    return recorded === hashOnDiskFile(absolute) ? "owned" : "modified";
  }
  const fromHome = relative(input.homeRoot, absolute).split(sep).join("/");
  const ownership = classifyManagedPathOwnership(input.homeRoot, fromHome);
  return ownership === "unowned" ? "unmanaged" : ownership;
}

/** Back up, then remove files of a host plugin folder (paths inside the folder). */
function backUpAndRemoveViewFiles(homeRoot: string, hostView: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  executeSafeFileRemovals(
    homeRoot,
    paths.map((path) => relative(homeRoot, join(hostView, path)).split(sep).join("/")),
    { mode: "listed" },
  );
}

function copyViewFiles(
  canonicalDir: string,
  hostView: string,
  paths: readonly string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    const source = join(canonicalDir, path);
    const dest = join(hostView, path);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(source, dest, { force: true });
    const hash = hashOnDiskFile(dest);
    if (hash) hashes[path] = hash;
  }
  return hashes;
}

/**
 * Write a plugin's package tree into the host plugin cache folder
 * (`~/.claude/plugins/cache/<mkt>/<name>/<ver>`).
 *
 * An existing folder is never removed wholesale. Files that already match
 * are left as they are. A file that differs or is no longer in the package is
 * replaced or removed only when HarnessTap wrote it and it is unchanged since;
 * every replaced or removed file is backed up first. Files HarnessTap did not
 * write, or that changed since, are kept and reported through
 * `takeKeptHostPluginViewFiles` (replaced only with `--force-remove`, or when
 * the user agrees). Only folders left empty are removed.
 */
export function mirrorHostPluginView(input: {
  homeRoot: string;
  marketplace: string;
  pluginName: string;
  version: string;
  canonicalDir: string;
}): string {
  const hostView = cacheVersionDir(
    input.homeRoot,
    input.marketplace,
    input.pluginName,
    input.version,
  );
  if (
    existsSync(hostView)
    && isPluginInstallRoot(hostView)
    && hostView === input.canonicalDir
  ) {
    return hostView;
  }
  const packageFiles = listTreeFiles(input.canonicalDir, (path) =>
    shouldCopyPackageTreePath(input.canonicalDir, path),
  );
  if (!existsSync(hostView)) {
    mkdirSync(hostView, { recursive: true });
    const files = copyViewFiles(input.canonicalDir, hostView, packageFiles);
    recordHostPluginViewFiles({ hostView, created: true, files });
    return hostView;
  }

  const record = readHostPluginViewRecord(hostView);
  const created = record?.created === true;
  const recorded = { ...(record?.files ?? {}) };
  const packageSet = new Set(packageFiles);
  const unchanged = new Set<string>();
  const replace: string[] = [];
  const kept: KeptHostPluginViewFiles["files"] = [];
  for (const path of listTreeFiles(hostView)) {
    if (packageSet.has(path) && sameBytes(join(hostView, path), join(input.canonicalDir, path))) {
      unchanged.add(path);
      continue;
    }
    const ownership = hostViewFileOwnership({
      homeRoot: input.homeRoot,
      hostView,
      path,
      recorded,
    });
    if (ownership === "owned" || hostPluginViewForceReplace()) {
      replace.push(path);
    } else {
      kept.push({ path, reason: ownership });
    }
  }

  backUpAndRemoveViewFiles(input.homeRoot, hostView, replace);
  const keptSet = new Set(kept.map((file) => file.path));
  const files = copyViewFiles(
    input.canonicalDir,
    hostView,
    packageFiles.filter((path) => !unchanged.has(path) && !keptSet.has(path)),
  );
  for (const path of unchanged) {
    const hash = recorded[path];
    if (hash) files[path] = hash;
  }
  removeEmptyDirsInside(hostView);
  recordHostPluginViewFiles({ hostView, created, files, dropFiles: replace });
  if (kept.length > 0) {
    recordKeptHostPluginViewFiles({
      homeRoot: input.homeRoot,
      hostView,
      canonicalDir: input.canonicalDir,
      files: kept,
    });
  }
  return hostView;
}

/** Remove the empty folders inside `dir`, never `dir` itself. */
function removeEmptyDirsInside(dir: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(dir, entry);
    try {
      if (statSync(child).isDirectory()) removeEmptyDirsUnder(child);
    } catch {
      // Unreadable entries stay.
    }
  }
}

/**
 * Replace the files a refresh kept, once the user agreed: back each one up,
 * then write the package version (or leave it removed when the package no
 * longer has it). Returns the paths replaced or removed, inside the folder.
 */
export function replaceKeptHostPluginViewFiles(entry: KeptHostPluginViewFiles): string[] {
  if (!existsSync(entry.hostView)) return [];
  const paths = entry.files.map((file) => file.path);
  const present = paths.filter((path) => existsSync(join(entry.hostView, path)));
  backUpAndRemoveViewFiles(entry.homeRoot, entry.hostView, present);
  const packaged = paths.filter((path) => existsSync(join(entry.canonicalDir, path)));
  mkdirSync(entry.hostView, { recursive: true });
  const files = copyViewFiles(entry.canonicalDir, entry.hostView, packaged);
  removeEmptyDirsInside(entry.hostView);
  recordHostPluginViewFiles({ hostView: entry.hostView, created: false, files, dropFiles: present });
  return paths;
}

export function ingestHostPluginTreeIntoCache(input: {
  harnesstapDir: string;
  homeRoot: string;
  originRef: string;
  sourceInstallRoot: string;
  version: string;
  pluginPinResourceId?: string | null;
}): string {
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    return input.sourceInstallRoot;
  }
  const canonical = hostPluginPackageDir(
    input.harnesstapDir,
    marketplace,
    name,
    input.version,
  );
  if (!existsSync(canonical) || !isPluginInstallRoot(canonical)) {
    mkdirSync(dirname(canonical), { recursive: true });
    if (existsSync(canonical)) {
      rmSync(canonical, { recursive: true, force: true });
    }
    copyPackageTree(input.sourceInstallRoot, canonical);
  }
  const relative = hostPluginPackageRelativePath(marketplace, name, input.version);
  upsertPackageCacheEntry({
    kind: "host_plugin",
    origin_ref: input.originRef,
    resolved_key: input.version,
    relative_path: relative,
    resource_id: input.pluginPinResourceId ?? null,
  });
  mirrorHostPluginView({
    homeRoot: input.homeRoot,
    marketplace,
    pluginName: name,
    version: input.version,
    canonicalDir: canonical,
  });
  return canonical;
}

export function resolveCanonicalHostPluginRoot(input: {
  harnesstapDir: string;
  originRef: string;
  version?: string | null;
}): string | undefined {
  const harnesstapDir = input.harnesstapDir ?? getHarnesstapDir();
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    return undefined;
  }
  const version = input.version?.trim();
  if (!version) {
    return undefined;
  }
  const onDisk = hostPluginPackageDir(
    harnesstapDir,
    marketplace,
    name,
    version,
  );
  if (existsSync(onDisk) && isPluginInstallRoot(onDisk)) {
    return onDisk;
  }
  const entry = findPackageCacheEntry({
    kind: "host_plugin",
    origin_ref: input.originRef,
    resolved_key: version,
  });
  if (entry) {
    const path = join(harnesstapDir, entry.relative_path);
    if (existsSync(path) && isPluginInstallRoot(path)) {
      return path;
    }
  }
  return undefined;
}

export {
  isInHostPluginViewCreatedByHarnessTap,
  pruneCreatedHostPluginView,
} from "./host-plugin-views.js";
