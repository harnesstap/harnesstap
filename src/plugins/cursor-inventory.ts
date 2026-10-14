import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { isAgentPluginsSchemaId } from "../services/agent-plugins/schema-registry.js";
import { fileSignature } from "../services/file-signature.js";
import { computationSlot } from "../services/status-computation.js";
import { listCursorNativeMcpPluginNames } from "./cursor-enablement.js";
import { parsePluginRef } from "./host-plugin-manifest.js";
import { readCursorLocalPluginSidecar } from "./cursor-local-plugin.js";
import {
  cursorCacheRoot,
  cursorLocalRoot,
  cursorMarketplacesRoot,
  cursorProjectsMcpsRoot,
} from "./refresh.js";
import type { PluginInstall } from "./types.js";

interface CursorPluginManifest {
  name: string;
  version?: string;
  description?: string;
  repository?: string;
  homepage?: string;
  $schema?: string;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isAgentPluginManifest(
  manifest: CursorPluginManifest,
  installPath: string,
): boolean {
  if (isAgentPluginsSchemaId(manifest.$schema)) {
    return true;
  }
  return (
    existsSync(join(installPath, "skills")) ||
    existsSync(join(installPath, "mcp.json"))
  );
}

function readInstallManifest(
  installPath: string,
): CursorPluginManifest | null {
  const cursorManifest = readJson<CursorPluginManifest>(
    join(installPath, ".cursor-plugin", "plugin.json"),
  );
  if (cursorManifest?.name) return cursorManifest;

  const rootManifest = readJson<CursorPluginManifest>(
    join(installPath, "plugin.json"),
  );
  if (
    rootManifest?.name &&
    isAgentPluginManifest(rootManifest, installPath)
  ) {
    return rootManifest;
  }

  const claudeManifest = readJson<CursorPluginManifest>(
    join(installPath, ".claude-plugin", "plugin.json"),
  );
  if (claudeManifest?.name) return claudeManifest;
  return null;
}

function toInstall(input: {
  manifest: CursorPluginManifest;
  marketplace: string;
  installPath: string;
  versionDirName?: string;
  scope: PluginInstall["scope"];
  enabled: boolean;
  ref?: string;
}): PluginInstall {
  const version =
    input.manifest.version ?? input.versionDirName ?? "unknown";
  return {
    ref: input.ref ?? `${input.manifest.name}@${input.marketplace}`,
    platformId: "cursor",
    name: input.manifest.name,
    version,
    versionSource: input.manifest.version ? "manifest" : "git_sha",
    scope: input.scope,
    enabled: input.enabled,
    installPath: input.installPath,
    metadata: {
      description: input.manifest.description,
      repository: input.manifest.repository,
      homepage: input.manifest.homepage,
    },
  };
}

function isUnderCursorPluginsRoot(
  homeRoot: string,
  installPath: string,
): boolean {
  const pluginsRoot = join(homeRoot, ".cursor", "plugins");
  const rel = relative(pluginsRoot, installPath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function isInventoriedCursorInstall(
  install: PluginInstall,
  homeRoot: string,
): boolean {
  if (!install.installPath) return true;
  return isUnderCursorPluginsRoot(homeRoot, install.installPath);
}

/** Newest version directory. Later mtime wins. Equal mtimes use the later name. */
function newestVersionDir(
  parent: string,
): { name: string; path: string } | null {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: { name: string; path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(parent, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (
      !best
      || mtimeMs > best.mtimeMs
      || (mtimeMs === best.mtimeMs && entry.name > best.name)
    ) {
      best = { name: entry.name, path, mtimeMs };
    }
  }
  return best ? { name: best.name, path: best.path } : null;
}

/**
 * One install per cache plugin: the newest version directory. Presence is
 * enough. Cursor's on/off state is not consulted.
 */
function scanCacheInstalls(homeRoot: string): PluginInstall[] {
  const cacheRoot = cursorCacheRoot(homeRoot);
  if (!existsSync(cacheRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const marketplace of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const marketplaceDir = join(cacheRoot, marketplace.name);
    for (const pluginDir of readdirSync(marketplaceDir, {
      withFileTypes: true,
    })) {
      if (!pluginDir.isDirectory()) continue;
      const versionDir = newestVersionDir(join(marketplaceDir, pluginDir.name));
      if (!versionDir) continue;
      const manifest = readInstallManifest(versionDir.path);
      if (!manifest?.name) continue;
      installs.push(
        toInstall({
          manifest,
          marketplace: marketplace.name,
          installPath: versionDir.path,
          versionDirName: versionDir.name,
          scope: "user",
          enabled: true,
        }),
      );
    }
  }
  return installs;
}

function scanLocalInstalls(homeRoot: string): PluginInstall[] {
  const localRoot = cursorLocalRoot(homeRoot);
  if (!existsSync(localRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const entry of readdirSync(localRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const installPath = join(localRoot, entry.name);
    const manifest = readInstallManifest(installPath);
    if (!manifest?.name) continue;
    const sidecar = readCursorLocalPluginSidecar(installPath);
    const origin = sidecar
      ? parsePluginRef(sidecar.origin_ref)
      : { name: manifest.name, marketplace: "local" };
    installs.push(
      toInstall({
        manifest,
        marketplace: origin.marketplace || "local",
        ref: sidecar?.origin_ref ?? `${manifest.name}@local`,
        installPath,
        scope: "local",
        enabled: true,
      }),
    );
  }
  return installs;
}

/**
 * Scan github.com/<owner>/<repo>/<sha> marketplace checkouts that are not
 * already represented in the cache inventory.
 */
function scanMarketplaceInstalls(
  homeRoot: string,
  existingRefs: ReadonlySet<string>,
): PluginInstall[] {
  const marketplacesRoot = cursorMarketplacesRoot(homeRoot);
  const hostRoot = join(marketplacesRoot, "github.com");
  if (!existsSync(hostRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const owner of readdirSync(hostRoot, { withFileTypes: true })) {
    if (!owner.isDirectory() || owner.name.startsWith("_")) continue;
    const ownerDir = join(hostRoot, owner.name);
    for (const repo of readdirSync(ownerDir, { withFileTypes: true })) {
      if (!repo.isDirectory()) continue;
      const versionDir = newestVersionDir(join(ownerDir, repo.name));
      if (!versionDir) continue;
      const manifest = readInstallManifest(versionDir.path);
      if (!manifest?.name) continue;
      const ref = `${manifest.name}@${owner.name}`;
      if (existingRefs.has(ref)) continue;
      const alreadyCached = [...existingRefs].some((existing) =>
        existing.startsWith(`${manifest.name}@`),
      );
      if (alreadyCached) continue;
      installs.push(
        toInstall({
          manifest,
          marketplace: owner.name,
          installPath: versionDir.path,
          versionDirName: versionDir.name,
          scope: "user",
          enabled: true,
        }),
      );
    }
  }
  return installs;
}

/** MCP folder identities that have no cache, marketplace, or local tree. */
function scanMcpOnlyInstalls(
  homeRoot: string,
  existingNames: ReadonlySet<string>,
): PluginInstall[] {
  const installs: PluginInstall[] = [];
  for (const name of listCursorNativeMcpPluginNames(homeRoot)) {
    if (existingNames.has(name)) continue;
    installs.push({
      ref: `${name}@cursor`,
      platformId: "cursor",
      name,
      version: "unknown",
      versionSource: "unknown",
      scope: "user",
      enabled: true,
    });
  }
  return installs;
}

/** Names present under Cursor's plugin root and native MCP folders. */
export function listCursorPluginFootprintNames(homeRoot: string): Set<string> {
  const names = new Set<string>();
  for (const install of listCursorPluginInstalls(homeRoot)) {
    names.add(install.name);
  }
  return names;
}

function cloneInstall(install: PluginInstall): PluginInstall {
  return {
    ...install,
    ...(install.metadata ? { metadata: { ...install.metadata } } : {}),
  };
}

/**
 * Inputs that change which Cursor installs are visible. Directory mtimes do
 * not always move when a nested file is rewritten, so apply, switch, and
 * install also call `clearCursorPluginInstallsCache`.
 */
export function cursorInventoryInputSignature(homeRoot: string): string {
  const plugins = join(homeRoot, ".cursor", "plugins");
  return [
    fileSignature(plugins),
    fileSignature(join(plugins, "cache")),
    fileSignature(join(plugins, "marketplaces")),
    fileSignature(join(plugins, "local")),
    fileSignature(cursorProjectsMcpsRoot(homeRoot)),
  ].join("|");
}

const cursorInstallsCache = new Map<string, { sig: string; installs: PluginInstall[] }>();

export function clearCursorPluginInstallsCache(): void {
  cursorInstallsCache.clear();
}

function scanCursorPluginInstalls(homeRoot: string): PluginInstall[] {
  const cache = scanCacheInstalls(homeRoot);
  const local = scanLocalInstalls(homeRoot);
  const refs = new Set(cache.map((row) => row.ref));
  const marketplaces = scanMarketplaceInstalls(homeRoot, refs);
  const named = new Set(
    [...cache, ...local, ...marketplaces].map((install) => install.name),
  );
  const mcp = scanMcpOnlyInstalls(homeRoot, named);
  return [...cache, ...local, ...marketplaces, ...mcp].filter((install) =>
    isInventoriedCursorInstall(install, homeRoot),
  );
}

/** Synchronous Cursor inventory used by status panels and the provider. */
export function listCursorPluginInstalls(homeRoot: string): PluginInstall[] {
  const installs = computationSlot(`cursor-inventory:${homeRoot}`, () => {
    const sig = cursorInventoryInputSignature(homeRoot);
    const cached = cursorInstallsCache.get(homeRoot);
    if (cached && cached.sig === sig) return cached.installs;
    const scanned = scanCursorPluginInstalls(homeRoot);
    cursorInstallsCache.set(homeRoot, { sig, installs: scanned });
    return scanned;
  });
  return installs.map(cloneInstall);
}
