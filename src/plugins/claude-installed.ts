import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PluginPinMetadata,
  ResourceCreateInput,
} from "../types.js";
import type { PluginInstall, PluginScope, PluginVersionSource } from "./types.js";

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

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function parsePluginRef(ref: string): { name: string; marketplace: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref, marketplace: "" };
  return { name: ref.slice(0, at), marketplace: ref.slice(at + 1) };
}

export function readManifestVersion(installPath: string): {
  version: string;
  versionSource: PluginVersionSource;
  metadata?: PluginInstall["metadata"];
} {
  const manifestPath = join(installPath, ".claude-plugin", "plugin.json");
  const manifest = readJsonFile<{
    version?: string;
    description?: string;
    repository?: string;
    homepage?: string;
  }>(manifestPath);
  if (manifest?.version) {
    return {
      version: manifest.version,
      versionSource: "manifest",
      metadata: {
        description: manifest.description,
        repository: manifest.repository,
        homepage: manifest.homepage,
      },
    };
  }
  return { version: "unknown", versionSource: "unknown" };
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

function preferInstalledRecord(
  current: PluginInstall | undefined,
  candidate: PluginInstall,
): boolean {
  if (!current) {
    return true;
  }
  if (candidate.scope === "user" && current.scope !== "user") {
    return true;
  }
  if (candidate.scope === current.scope) {
    return false;
  }
  return false;
}

/**
 * Build `plugin_pin` create inputs from Claude's installed_plugins.json.
 * Dedupes by ref; prefers user-scope installs when both exist.
 * Does not sync child resources — run `resource sync` for that.
 */
export function listInstalledPluginPinCreateInputs(
  homeRoot: string,
): ResourceCreateInput[] {
  const byRef = new Map<string, PluginInstall>();
  for (const install of loadInstalled(homeRoot)) {
    if (!install.installPath || !existsSync(install.installPath)) {
      continue;
    }
    const current = byRef.get(install.ref);
    if (preferInstalledRecord(current, install)) {
      byRef.set(install.ref, install);
    }
  }

  return [...byRef.values()]
    .sort((left, right) => left.ref.localeCompare(right.ref))
    .map((install) => {
      const { name, marketplace } = parsePluginRef(install.ref);
      const metadata: PluginPinMetadata = {
        source_kind: marketplace ? "marketplace" : "local",
        ...(marketplace ? { marketplace_name: marketplace } : {}),
        ...(install.version && install.version !== "unknown"
          ? { resolved_version: install.version }
          : {}),
        sync_status: "never_synced",
        portable: "reference",
      };
      return {
        type: "plugin_pin" as const,
        name,
        namespace: marketplace,
        description:
          install.metadata?.description?.trim()
          || `Plugin pin: ${install.ref}`,
        content: "{}",
        metadata,
        source: "~/.claude/plugins/installed_plugins.json",
        origin_kind: marketplace ? ("marketplace_link" as const) : ("manual" as const),
        origin_ref: install.ref,
      };
    });
}
