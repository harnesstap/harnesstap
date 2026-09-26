import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import semver from "semver";
import {
  claudePluginsDir,
  getInstalledPluginRecord,
  parsePluginRef,
  readJsonFile,
  readManifestVersion,
  resolveInstalledRecordPath,
  writeInstalledPluginRecord,
} from "../plugins/claude-installed.js";
import type { PluginPinMetadata, Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { isPluginInstallRoot } from "./plugin-source-import.js";

const GIT_SHA_DIR = /^[0-9a-f]{7,40}$/i;

export type HostPluginVersionErrorCode =
  | "not_plugin"
  | "missing_marketplace"
  | "version_not_found";

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

interface MarketplacePluginEntry {
  name?: string;
  version?: string;
}

interface MarketplaceFile {
  plugins?: MarketplacePluginEntry[];
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

function advertisedMarketplaceVersion(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): string | null {
  const marketplacePath = join(
    claudePluginsDir(homeRoot),
    "marketplaces",
    marketplace,
    ".claude-plugin",
    "marketplace.json",
  );
  const file = readJsonFile<MarketplaceFile>(marketplacePath);
  const entry = file?.plugins?.find((plugin) => plugin.name === pluginName);
  const version = entry?.version?.trim();
  return version ? version : null;
}

function listCacheVersionDirs(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): Array<{ version: string; path: string; manifest_version: string | null }> {
  const parent = cachePluginDir(homeRoot, marketplace, pluginName);
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

export function listHostPluginVersions(
  originRef: string,
  homeRoot?: string,
): HostPluginVersionInfo {
  const resolvedHome = homeRoot ?? resolveHomeRoot();
  const { name, marketplace } = parsePluginRef(originRef);
  const advertised_version = marketplace
    ? advertisedMarketplaceVersion(resolvedHome, marketplace, name)
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
