import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
  collectCursorEnablementSignals,
  type CollectCursorEnablementSignals,
  type CursorEnablementSignals,
} from "./cursor-enablement.js";
import { parsePluginRef } from "./host-plugin-manifest.js";
import {
  cursorLocalPluginLoadState,
  readCursorLocalPluginLoadLog,
  readCursorLocalPluginSidecar,
} from "./cursor-local-plugin.js";
import {
  cursorCacheRoot,
  cursorLocalRoot,
  cursorMarketplacesRoot,
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
  if (
    typeof manifest.$schema === "string" &&
    manifest.$schema.includes("agent-plugins")
  ) {
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
  cursorLoad?: PluginInstall["cursorLoad"];
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
    ...(input.cursorLoad ? { cursorLoad: input.cursorLoad } : {}),
    metadata: {
      description: input.manifest.description,
      repository: input.manifest.repository,
      homepage: input.manifest.homepage,
    },
  };
}

function isEnabledForCachePlugin(
  name: string,
  signals: CursorEnablementSignals,
): boolean {
  return signals.pluginNames.has(name);
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
  signals: CursorEnablementSignals,
  homeRoot: string,
): boolean {
  if (!install.installPath || !isUnderCursorPluginsRoot(homeRoot, install.installPath)) {
    return false;
  }
  if (install.scope === "local") {
    return true;
  }
  return isEnabledForCachePlugin(install.name, signals);
}

function scanCacheInstalls(
  homeRoot: string,
  signals: CursorEnablementSignals,
): PluginInstall[] {
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
      const pluginPath = join(marketplaceDir, pluginDir.name);
      for (const versionDir of readdirSync(pluginPath, {
        withFileTypes: true,
      })) {
        if (!versionDir.isDirectory()) continue;
        const installPath = join(pluginPath, versionDir.name);
        const manifest = readInstallManifest(installPath);
        if (!manifest?.name) continue;
        installs.push(
          toInstall({
            manifest,
            marketplace: marketplace.name,
            installPath,
            versionDirName: versionDir.name,
            scope: "user",
            enabled: isEnabledForCachePlugin(manifest.name, signals),
          }),
        );
      }
    }
  }
  return installs;
}

function scanLocalInstalls(
  homeRoot: string,
  shadowedNames: ReadonlySet<string>,
): PluginInstall[] {
  const localRoot = cursorLocalRoot(homeRoot);
  if (!existsSync(localRoot)) return [];
  const loadLog = readCursorLocalPluginLoadLog(homeRoot);

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
    let folderMtimeMs = 0;
    try {
      folderMtimeMs = statSync(installPath).mtimeMs;
    } catch {
      folderMtimeMs = 0;
    }
    const shadowed = shadowedNames.has(manifest.name);
    installs.push(
      toInstall({
        manifest,
        marketplace: origin.marketplace || "local",
        ref: sidecar?.origin_ref ?? `${manifest.name}@local`,
        installPath,
        scope: "local",
        enabled: true,
        cursorLoad: cursorLocalPluginLoadState({
          folderName: entry.name,
          folderMtimeMs,
          shadowed,
          logText: loadLog?.text ?? null,
          logMtimeMs: loadLog?.mtimeMs ?? null,
        }),
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
  signals: CursorEnablementSignals,
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
      const repoDir = join(ownerDir, repo.name);
      for (const versionDir of readdirSync(repoDir, { withFileTypes: true })) {
        if (!versionDir.isDirectory()) continue;
        const installPath = join(repoDir, versionDir.name);
        const manifest = readInstallManifest(installPath);
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
            installPath,
            versionDirName: versionDir.name,
            scope: "user",
            enabled: isEnabledForCachePlugin(manifest.name, signals),
          }),
        );
      }
    }
  }
  return installs;
}

/** Names present under Cursor's plugin root, including cached-but-disabled trees. */
export function listCursorPluginFootprintNames(homeRoot: string): Set<string> {
  const emptySignals: CursorEnablementSignals = { pluginNames: new Set() };
  const names = new Set<string>();
  for (const install of [
    ...scanCacheInstalls(homeRoot, emptySignals),
    ...scanLocalInstalls(homeRoot, new Set()),
    ...scanMarketplaceInstalls(homeRoot, new Set(), emptySignals),
  ]) {
    if (install.installPath && isUnderCursorPluginsRoot(homeRoot, install.installPath)) {
      names.add(install.name);
    }
  }
  return names;
}

/** Synchronous Cursor inventory used by status panels and the provider. */
export function listCursorPluginInstalls(
  homeRoot: string,
  collectSignals: CollectCursorEnablementSignals = collectCursorEnablementSignals,
): PluginInstall[] {
  const signals = collectSignals(homeRoot);
  const cache = scanCacheInstalls(homeRoot, signals);
  const shadowed = new Set(
    cache.filter((install) => install.enabled).map((install) => install.name),
  );
  const local = scanLocalInstalls(homeRoot, shadowed);
  const refs = new Set(cache.map((row) => row.ref));
  const marketplaces = scanMarketplaceInstalls(homeRoot, refs, signals);
  return [...cache, ...local, ...marketplaces].filter((install) =>
    isInventoriedCursorInstall(install, signals, homeRoot),
  );
}
