import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResourceCreateInput } from "../types.js";
import {
  parsePluginRef,
  readFirstHostPluginManifest,
  readJsonFile,
} from "./host-plugin-manifest.js";
import { dedupePluginInstalls, hasInstallPath, pluginInstallToPinInput } from "./host-plugin-pins.js";
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

export function readInstalledPluginsFile(
  homeRoot: string,
): InstalledPluginsFile | null {
  const path = join(claudePluginsDir(homeRoot), "installed_plugins.json");
  return readJsonFile<InstalledPluginsFile>(path);
}

export function getInstalledPluginRecord(
  homeRoot: string,
  ref: string,
): InstalledPluginRecord | null {
  const file = readInstalledPluginsFile(homeRoot);
  return file?.plugins[ref]?.[0] ?? null;
}

export function getInstalledPluginInstallPath(
  homeRoot: string,
  ref: string,
  candidateRefs?: string[],
): string | null {
  const file = readInstalledPluginsFile(homeRoot);
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

export function writeInstalledPluginRecord(
  homeRoot: string,
  ref: string,
  record: InstalledPluginRecord,
): void {
  const path = join(claudePluginsDir(homeRoot), "installed_plugins.json");
  const existing = readInstalledPluginsFile(homeRoot);
  const file: InstalledPluginsFile = {
    version: existing?.version ?? 2,
    plugins: { ...(existing?.plugins ?? {}) },
  };
  const current = file.plugins[ref] ?? [];
  const previous = current.find((row) => row.scope === record.scope);
  const rest = current.filter((row) => row.scope !== record.scope);
  file.plugins[ref] = [{ ...previous, ...record }, ...rest];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
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
    .filter(hasInstallPath)
    .map((install) =>
      pluginInstallToPinInput(
        install,
        "~/.claude/plugins/installed_plugins.json",
      ),
    );
}
