import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../../db/connection.js";
import { parsePluginRef } from "../../plugins/claude-installed.js";
import {
  findPackageCacheEntry,
  upsertPackageCacheEntry,
} from "../../models/package-cache-entry.js";
import { cacheVersionDir } from "../host-plugin-source.js";
import { isPluginInstallRoot } from "../plugin-source-import.js";
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
  const existed = existsSync(hostView);
  if (existed) {
    rmSync(hostView, { recursive: true, force: true });
  }
  mkdirSync(dirname(hostView), { recursive: true });
  copyPackageTree(input.canonicalDir, hostView);
  if (!existed) recordCreatedHostView(hostView);
  return hostView;
}

/**
 * Host plugin cache folders (`~/.claude/plugins/cache/<mkt>/<name>/<ver>`)
 * that HarnessTap created from its package cache, kept in
 * `<harnesstap>/cache/host-plugin-views.json`. An install (`plugin add`, a
 * dependency sync) copies the tree there before the apply runs; the apply
 * then emits the same bytes, finds them unchanged and writes nothing, so it
 * would record no ownership and later call HarnessTap's own files "not made
 * by HarnessTap". Folders that already existed (a Claude install) are never
 * listed.
 */
function createdHostViewsPath(): string {
  return join(getHarnesstapDir(), "cache", "host-plugin-views.json");
}

function readCreatedHostViews(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(createdHostViewsPath(), "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function recordCreatedHostView(hostView: string): void {
  const views = readCreatedHostViews();
  const resolved = resolve(hostView);
  if (views.includes(resolved)) return;
  try {
    mkdirSync(dirname(createdHostViewsPath()), { recursive: true });
    writeFileSync(createdHostViewsPath(), `${JSON.stringify([...views, resolved].sort(), null, 2)}\n`);
  } catch {
    // Best effort: without the record the files are only kept, never lost.
  }
}

/** True when `absolutePath` is inside a host plugin folder HarnessTap created. */
export function isInHostPluginViewCreatedByHarnessTap(absolutePath: string): boolean {
  const target = resolve(absolutePath);
  return readCreatedHostViews().some((view) => target.startsWith(`${view}${sep}`));
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

function removeEmptyDirsUnder(dir: string): void {
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
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // A folder that cannot be read or removed stays.
  }
}

/**
 * After removing files from a host plugin folder HarnessTap created, remove
 * the folders it left empty (container folders like `skills/` included, up
 * to `plugins/cache`), and forget the folder once it is gone. Only empty
 * folders are removed, so nothing anyone else put there is touched.
 */
export function pruneCreatedHostPluginView(removedFile: string): void {
  const target = resolve(removedFile);
  const views = readCreatedHostViews();
  const view = views.find((candidate) => target.startsWith(`${candidate}${sep}`));
  if (!view) return;
  removeEmptyDirsUnder(view);
  if (existsSync(view)) return;
  let parent = dirname(view);
  while (basename(parent) !== "cache" && parent !== dirname(parent)) {
    try {
      if (readdirSync(parent).length > 0) break;
      rmdirSync(parent);
    } catch {
      break;
    }
    parent = dirname(parent);
  }
  try {
    writeFileSync(
      createdHostViewsPath(),
      `${JSON.stringify(views.filter((candidate) => candidate !== view), null, 2)}\n`,
    );
  } catch {
    // The record is pruned on the next removal.
  }
}
