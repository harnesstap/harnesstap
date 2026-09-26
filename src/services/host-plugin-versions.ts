import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import semver from "semver";
import { getHarnesstapDir } from "../db/connection.js";
import {
  claudePluginsDir,
  getInstalledPluginRecord,
  parsePluginRef,
  readManifestVersion,
  resolveInstalledRecordPath,
  writeInstalledPluginRecord,
} from "../plugins/claude-installed.js";
import { cursorCacheRoot } from "../plugins/refresh.js";
import type { RunCommand } from "../plugins/run-command.js";
import type { PluginPinMetadata, Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  downloadHostPluginVersion,
  isRelativePluginSourcePath,
  marketplaceNotInstalledMessage,
  pullHostPluginSourceVersions,
  readHostPluginSourceSnapshot,
  readMarketplacePluginSource,
  resolveMarketplaceCloneUrl,
  resolveMarketplaceRoot,
  defaultMarketplaceRoot,
} from "./host-plugin-source.js";
import { isPluginInstallRoot } from "./plugin-source-import.js";

const GIT_SHA_DIR = /^[0-9a-f]{7,40}$/i;

export type HostPluginVersionErrorCode =
  | "not_plugin"
  | "missing_marketplace"
  | "version_not_found"
  | "source_unavailable"
  | "pull_failed"
  | "download_failed";

export class HostPluginVersionError extends Error {
  readonly code: HostPluginVersionErrorCode;

  constructor(code: HostPluginVersionErrorCode, message: string) {
    super(message);
    this.name = "HostPluginVersionError";
    this.code = code;
  }
}

export interface HostPluginCacheVersion {
  version: string;
  path: string;
  manifest_version: string | null;
  current: boolean;
  advertised: boolean;
}

export interface HostPluginVersionInfo {
  current_version: string | null;
  advertised_version: string | null;
  available_versions: HostPluginCacheVersion[];
}

export function isCacheVersionDirectoryName(name: string): boolean {
  return semver.valid(name) !== null || GIT_SHA_DIR.test(name);
}

export function resolvedVersionFromInstallRoot(
  installRoot: string,
  manifestVersion?: string | null,
): string {
  const dirName = basename(installRoot);
  if (isCacheVersionDirectoryName(dirName)) {
    return dirName;
  }
  if (manifestVersion && manifestVersion !== "unknown") {
    return manifestVersion;
  }
  return dirName;
}

export function sortHostPluginVersionNames(versions: string[]): string[] {
  const unique = [...new Set(versions.filter((version) => version.length > 0))];
  const semverVersions = unique
    .filter((version) => semver.valid(version) !== null)
    .sort(semver.rcompare);
  const rest = unique
    .filter((version) => semver.valid(version) === null)
    .sort((left, right) => right.localeCompare(left));
  return [...semverVersions, ...rest];
}

function cachePluginDir(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): string {
  return join(claudePluginsDir(homeRoot), "cache", marketplace, pluginName);
}

export function missingMarketplacePullMessage(originRef: string): string {
  return `Plugin ${originRef} has no marketplace, so source versions cannot be pulled`;
}

export function hostPluginPullUnavailableReason(
  originRef: string,
  homeRoot?: string,
): string | null {
  const resolvedHome = homeRoot ?? resolveHomeRoot();
  const { marketplace } = parsePluginRef(originRef);
  if (!marketplace) {
    return missingMarketplacePullMessage(originRef);
  }
  const url = resolveMarketplaceCloneUrl(resolvedHome, marketplace);
  const root =
    resolveMarketplaceRoot(resolvedHome, marketplace) ??
    defaultMarketplaceRoot(resolvedHome, marketplace);
  if (url || existsSync(root)) {
    return null;
  }
  return marketplaceNotInstalledMessage(marketplace);
}

export function highestHostPluginSourceVersion(
  versions: Array<string | null | undefined>,
): string | null {
  const names = sortHostPluginVersionNames(
    versions.filter((version): version is string => Boolean(version?.trim())),
  );
  return names[0] ?? null;
}

function advertisedMarketplaceVersion(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): string | null {
  return (
    readMarketplacePluginSource(homeRoot, marketplace, pluginName)?.version ??
    null
  );
}

function checkoutPluginManifestVersion(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): string | null {
  const live = readMarketplacePluginSource(homeRoot, marketplace, pluginName);
  if (!isRelativePluginSourcePath(live?.path)) {
    return null;
  }
  const root = resolveMarketplaceRoot(homeRoot, marketplace);
  if (!root) {
    return null;
  }
  const relative = live?.path?.trim() ?? "";
  const pluginDir =
    relative === "." || relative === "./" ? root : join(root, relative);
  if (!existsSync(pluginDir)) {
    return null;
  }
  const manifest = readManifestVersion(pluginDir);
  return manifest.version !== "unknown" ? manifest.version : null;
}

function scanCacheParent(
  parent: string,
): Array<{ version: string; path: string; manifest_version: string | null }> {
  if (!existsSync(parent)) {
    return [];
  }
  if (isPluginInstallRoot(parent)) {
    const manifest = readManifestVersion(parent);
    return [
      {
        version: resolvedVersionFromInstallRoot(
          parent,
          manifest.version === "unknown" ? null : manifest.version,
        ),
        path: parent,
        manifest_version:
          manifest.version !== "unknown" ? manifest.version : null,
      },
    ];
  }
  try {
    const rows: Array<{
      version: string;
      path: string;
      manifest_version: string | null;
    }> = [];
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(parent, entry.name);
      if (!isPluginInstallRoot(path)) continue;
      const manifest = readManifestVersion(path);
      rows.push({
        version: entry.name,
        path,
        manifest_version:
          manifest.version !== "unknown" ? manifest.version : null,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function listCacheVersionDirs(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): Array<{ version: string; path: string; manifest_version: string | null }> {
  const rows = [
    ...scanCacheParent(cachePluginDir(homeRoot, marketplace, pluginName)),
    ...scanCacheParent(
      join(cursorCacheRoot(homeRoot), marketplace, pluginName),
    ),
  ];
  const byVersion = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byVersion.has(row.version)) {
      byVersion.set(row.version, row);
    }
  }
  return [...byVersion.values()];
}

export function listHostPluginVersions(
  originRef: string,
  homeRoot?: string,
): HostPluginVersionInfo {
  const resolvedHome = homeRoot ?? resolveHomeRoot();
  const { name, marketplace } = parsePluginRef(originRef);
  const catalogVersion = marketplace
    ? advertisedMarketplaceVersion(resolvedHome, marketplace, name)
    : null;
  const snapshot = readHostPluginSourceSnapshot(originRef, getHarnesstapDir());
  const advertised_version = marketplace
    ? highestHostPluginSourceVersion([
        catalogVersion,
        checkoutPluginManifestVersion(resolvedHome, marketplace, name),
        ...Object.keys(snapshot?.git_refs ?? {}),
      ])
    : null;
  const record = getInstalledPluginRecord(resolvedHome, originRef);
  const installedPath = record
    ? resolveInstalledRecordPath(resolvedHome, record)
    : null;
  const cacheRows = marketplace
    ? listCacheVersionDirs(resolvedHome, marketplace, name)
    : [];

  let current_version: string | null = null;
  if (installedPath && existsSync(installedPath)) {
    current_version = resolvedVersionFromInstallRoot(
      installedPath,
      record?.version,
    );
  } else if (record?.version && record.version !== "unknown") {
    current_version = record.version;
  } else if (cacheRows.length === 1) {
    current_version = cacheRows[0]?.version ?? null;
  }

  const byVersion = new Map<string, HostPluginCacheVersion>();
  for (const row of cacheRows) {
    byVersion.set(row.version, {
      version: row.version,
      path: row.path,
      manifest_version: row.manifest_version,
      current: row.version === current_version,
      advertised: advertised_version === row.version,
    });
  }
  if (
    current_version &&
    !byVersion.has(current_version) &&
    installedPath &&
    existsSync(installedPath)
  ) {
    const manifest = readManifestVersion(installedPath);
    byVersion.set(current_version, {
      version: current_version,
      path: installedPath,
      manifest_version:
        manifest.version !== "unknown" ? manifest.version : null,
      current: true,
      advertised: advertised_version === current_version,
    });
  }

  const remoteVersions = [
    ...(advertised_version ? [advertised_version] : []),
    ...Object.keys(snapshot?.git_refs ?? {}),
  ];
  for (const version of remoteVersions) {
    if (byVersion.has(version)) {
      continue;
    }
    byVersion.set(version, {
      version,
      path: "",
      manifest_version: null,
      current: version === current_version,
      advertised: advertised_version === version,
    });
  }

  const available_versions = sortHostPluginVersionNames([...byVersion.keys()]).map(
    (version) => {
      const row = byVersion.get(version);
      if (!row) {
        return {
          version,
          path: "",
          manifest_version: null,
          current: version === current_version,
          advertised: advertised_version === version,
        };
      }
      return {
        ...row,
        current: version === current_version,
        advertised: advertised_version === version,
      };
    },
  );

  return { current_version, advertised_version, available_versions };
}

export function pullHostPluginVersions(input: {
  originRef: string;
  homeRoot?: string;
  harnesstapDir?: string;
  runCommand?: RunCommand;
}): HostPluginVersionInfo {
  const { marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    throw new HostPluginVersionError(
      "missing_marketplace",
      missingMarketplacePullMessage(input.originRef),
    );
  }
  try {
    pullHostPluginSourceVersions({
      originRef: input.originRef,
      homeRoot: input.homeRoot,
      harnesstapDir: input.harnesstapDir,
      runCommand: input.runCommand,
    });
  } catch (error) {
    throw new HostPluginVersionError(
      "pull_failed",
      error instanceof Error ? error.message : "Could not pull plugin versions",
    );
  }
  const info = listHostPluginVersions(input.originRef, input.homeRoot);
  if (
    info.available_versions.length === 0 &&
    !info.advertised_version &&
    !info.current_version
  ) {
    throw new HostPluginVersionError(
      "source_unavailable",
      `No versions found for ${input.originRef}`,
    );
  }
  return info;
}

export function ensureHostPluginVersionInstalled(input: {
  originRef: string;
  version: string;
  homeRoot?: string;
  harnesstapDir?: string;
  runCommand?: RunCommand;
}): { version: string; install_path: string } {
  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const info = listHostPluginVersions(input.originRef, homeRoot);
  const selected = info.available_versions.find(
    (row) => row.version === input.version,
  );
  if (selected?.path && existsSync(selected.path)) {
    return { version: selected.version, install_path: selected.path };
  }
  try {
    return downloadHostPluginVersion({
      originRef: input.originRef,
      version: input.version,
      homeRoot,
      harnesstapDir: input.harnesstapDir,
      runCommand: input.runCommand,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not download plugin version";
    if (/not available from the source/i.test(message)) {
      throw new HostPluginVersionError("version_not_found", message);
    }
    throw new HostPluginVersionError("download_failed", message);
  }
}

export function retargetHostPluginVersion(input: {
  originRef: string;
  version: string;
  homeRoot?: string;
}): { version: string; install_path: string; unchanged: boolean } {
  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const originRef = input.originRef;
  const { marketplace } = parsePluginRef(originRef);
  if (!marketplace) {
    throw new HostPluginVersionError(
      "missing_marketplace",
      `Plugin ${originRef} has no marketplace, so its host cache version cannot be switched`,
    );
  }
  const info = listHostPluginVersions(originRef, homeRoot);
  const selected = info.available_versions.find(
    (row) => row.version === input.version,
  );
  if (!selected || !selected.path) {
    throw new HostPluginVersionError(
      "version_not_found",
      `Version ${input.version} is not available in the host cache for ${originRef}`,
    );
  }
  if (info.current_version === input.version) {
    return {
      version: selected.version,
      install_path: selected.path,
      unchanged: true,
    };
  }

  const relativePath = selected.path.startsWith(claudePluginsDir(homeRoot))
    ? selected.path.slice(claudePluginsDir(homeRoot).length).replace(/^[/\\]/, "")
    : selected.path;
  const existing = getInstalledPluginRecord(homeRoot, originRef);
  writeInstalledPluginRecord(homeRoot, originRef, {
    scope: existing?.scope ?? "user",
    installPath: relativePath,
    version: selected.version,
    ...(existing?.installedAt ? { installedAt: existing.installedAt } : {}),
    lastUpdated: new Date().toISOString(),
    ...(existing?.gitCommitSha ? { gitCommitSha: existing.gitCommitSha } : {}),
  });
  return {
    version: selected.version,
    install_path: selected.path,
    unchanged: false,
  };
}

export function hostPluginMetadataForVersion(
  resource: Resource,
  version: string,
): PluginPinMetadata {
  return {
    ...(resource.metadata as PluginPinMetadata),
    resolved_version: version,
    sync_status: "synced",
  };
}
