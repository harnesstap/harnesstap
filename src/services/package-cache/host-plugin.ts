import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
  mkdirSync(dirname(hostView), { recursive: true });
  cpSync(input.canonicalDir, hostView, { recursive: true, force: true });
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
    cpSync(input.sourceInstallRoot, canonical, { recursive: true, force: true });
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
