import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
  if (existsSync(hostView)) {
    rmSync(hostView, { recursive: true, force: true });
  }
  mkdirSync(dirname(hostView), { recursive: true });
  copyPackageTree(input.canonicalDir, hostView);
  return hostView;
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
