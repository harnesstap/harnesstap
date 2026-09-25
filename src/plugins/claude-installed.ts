import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResourceCreateInput } from "../types.js";
import {
  parsePluginRef,
  readFirstHostPluginManifest,
  readJsonFile,
} from "./host-plugin-manifest.js";
import { dedupePluginInstalls, pluginInstallToPinInput } from "./host-plugin-pins.js";
import type { PluginInstall, PluginScope, PluginVersionSource } from "./types.js";

export { parsePluginRef, readJsonFile };

export interface InstalledPluginRecord {
  scope: PluginScope;
  installPath: string;
  version: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

export interface InstalledPluginsFile {
  version?: number;
  plugins: Record<string, InstalledPluginRecord[]>;
}

export function claudePluginsDir(homeRoot: string): string {
  return join(homeRoot, ".claude", "plugins");
}

export function readManifestVersion(installPath: string): {
  version: string;
  versionSource: PluginVersionSource;
  metadata?: PluginInstall["metadata"];
} {
  const manifest = readFirstHostPluginManifest(installPath);
  if (!manifest) {
    return { version: "unknown", versionSource: "unknown" };
  }
  const metadata = {
    description: manifest.description,
    repository: manifest.repository,
    homepage: manifest.homepage,
  };
  if (manifest.version) {
    return {
      version: manifest.version,
      versionSource: "manifest",
      metadata,
    };
  }
  return { version: "unknown", versionSource: "unknown", metadata };
}

export function resolveInstalledRecordPath(
  homeRoot: string,
  record: InstalledPluginRecord,
): string {
  return record.installPath.startsWith("/")
    ? record.installPath
    : join(claudePluginsDir(homeRoot), record.installPath);
}

export function getInstalledPluginInstallPath(
  homeRoot: string,
  ref: string,
  candidateRefs?: string[],
): string | null {
  const path = join(claudePluginsDir(homeRoot), "installed_plugins.json");
  const file = readJsonFile<InstalledPluginsFile>(path);
  if (!file?.plugins) {
    return null;
  }

  const refs = candidateRefs?.length ? candidateRefs : [ref];
  for (const candidate of refs) {
    const record = file.plugins[candidate]?.[0];
    if (!record?.installPath) {
      continue;
    }
    return resolveInstalledRecordPath(homeRoot, record);
  }

  return null;
}

export function loadInstalled(homeRoot: string): PluginInstall[] {
  const path = join(claudePluginsDir(homeRoot), "installed_plugins.json");
  const file = readJsonFile<InstalledPluginsFile>(path);
  if (!file?.plugins) return [];

  const installs: PluginInstall[] = [];
  for (const [ref, records] of Object.entries(file.plugins)) {
    for (const record of records) {
      const resolvedPath = resolveInstalledRecordPath(homeRoot, record);
      const manifest = record.installPath
        ? readManifestVersion(resolvedPath)
        : { version: record.version, versionSource: "unknown" as const };
      const version =
        manifest.version !== "unknown" ? manifest.version : record.version;
      installs.push({
        ref,
        platformId: "claude-code",
        name: parsePluginRef(ref).name,
        version,
        versionSource:
          record.gitCommitSha && version === record.version
            ? "git_sha"
            : manifest.versionSource,
        scope: record.scope,
        enabled: true,
        installPath: resolvedPath,
        metadata: manifest.metadata,
      });
    }
  }
  return installs;
}

/**
 * Build `plugin_pin` create inputs from Claude's installed_plugins.json.
 * Dedupes by ref; prefers user-scope installs when both exist.
 * Does not sync child resources — run `resource sync` for that.
 */
export function listInstalledPluginPinCreateInputs(
  homeRoot: string,
): ResourceCreateInput[] {
  return dedupePluginInstalls(loadInstalled(homeRoot))
    .filter(
      (install) =>
        Boolean(install.installPath) && existsSync(install.installPath as string),
    )
    .map((install) =>
      pluginInstallToPinInput(
        install,
        "~/.claude/plugins/installed_plugins.json",
      ),
    );
}
