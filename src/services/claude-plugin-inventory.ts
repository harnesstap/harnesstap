import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import {
  claudePluginsDir,
  parsePluginRef,
  readJsonFile,
  readManifestVersion,
  resolveInstalledRecordPath,
  type InstalledPluginsFile,
} from "../plugins/claude-installed.js";
import type { PluginInstall, PluginScope } from "../plugins/types.js";

export interface ProjectPluginInventory {
  scanned_at: string;
  committed: PluginInstall[];
  effective: PluginInstall[];
}

export interface ScanClaudePluginInventoryOptions {
  projectRoot: string;
  homeRoot: string;
}

interface ClaudeSettingsFile {
  enabledPlugins?: unknown;
}

function normalizeEnabledPlugins(raw: unknown): Map<string, boolean> {
  const m = new Map<string, boolean>();
  if (raw == null) return m;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") m.set(item, true);
    }
    return m;
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "boolean") m.set(k, v);
    }
  }
  return m;
}

function readSettingsEnabledMap(baseDir: string, fileName: string): Map<string, boolean> {
  const path = join(baseDir, ".claude", fileName);
  const settings = readJsonFile<ClaudeSettingsFile>(path);
  return normalizeEnabledPlugins(settings?.enabledPlugins);
}

function collectInRepoPluginDirs(projectRoot: string): Map<string, string> {
  const byManifestName = new Map<string, string>();
  const pluginsRoot = join(projectRoot, "plugins");
  try {
    if (!statSync(pluginsRoot).isDirectory()) return byManifestName;
  } catch {
    return byManifestName;
  }

  const stack = [pluginsRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".claude-plugin") {
          const manifestPath = join(full, "plugin.json");
          const manifest = readJsonFile<{ name?: string }>(manifestPath);
          if (manifest?.name) {
            const installDir = join(full, "..");
            byManifestName.set(manifest.name, installDir);
          }
        } else {
          stack.push(full);
        }
      }
    }
  }
  return byManifestName;
}

function getInstalledPathForRef(homeRoot: string, ref: string): string | null {
  const path = join(claudePluginsDir(homeRoot), "installed_plugins.json");
  const file = readJsonFile<InstalledPluginsFile>(path);
  const record = file?.plugins?.[ref]?.[0];
  if (!record?.installPath) return null;
  return resolveInstalledRecordPath(homeRoot, record);
}

function resolveInstallPath(
  homeRoot: string,
  ref: string,
  inRepoByName: Map<string, string>,
): string | null {
  const fromInstalled = getInstalledPathForRef(homeRoot, ref);
  if (fromInstalled) return fromInstalled;
  const { name } = parsePluginRef(ref);
  return inRepoByName.get(name) ?? null;
}

function buildInstall(
  ref: string,
  scope: PluginScope,
  enabled: boolean,
  installPath: string | null,
): PluginInstall {
  const manifest = installPath
    ? readManifestVersion(installPath)
    : { version: "unknown", versionSource: "unknown" as const };
  return {
    ref,
    platformId: "claude-code",
    name: parsePluginRef(ref).name,
    version: manifest.version,
    versionSource: manifest.versionSource,
    scope,
    enabled,
    ...(installPath ? { installPath } : {}),
    ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
  };
}

/** Scopes whose settings files explicitly list this plugin ref (may include multiple layers). */
export function declaringScopesForClaudePlugin(
  ref: string,
  opts: ScanClaudePluginInventoryOptions,
): PluginScope[] {
  const { projectRoot, homeRoot } = opts;
  const userMap = readSettingsEnabledMap(homeRoot, "settings.json");
  const projectMap = readSettingsEnabledMap(projectRoot, "settings.json");
  const localMap = readSettingsEnabledMap(projectRoot, "settings.local.json");

  const scopes: PluginScope[] = [];
  if (userMap.has(ref)) scopes.push("user");
  if (projectMap.has(ref)) scopes.push("project");
  if (localMap.has(ref)) scopes.push("local");
  return scopes;
}

export async function scanClaudePluginInventory(
  opts: ScanClaudePluginInventoryOptions,
): Promise<ProjectPluginInventory> {
  const { projectRoot, homeRoot } = opts;
  const userMap = readSettingsEnabledMap(homeRoot, "settings.json");
  const projectMap = readSettingsEnabledMap(projectRoot, "settings.json");
  const localMap = readSettingsEnabledMap(projectRoot, "settings.local.json");
  const inRepoByName = collectInRepoPluginDirs(projectRoot);

  const unionRefs = new Set<string>([
    ...userMap.keys(),
    ...projectMap.keys(),
    ...localMap.keys(),
  ]);

  const committed: PluginInstall[] = [];
  for (const ref of projectMap.keys()) {
    const installPath = resolveInstallPath(homeRoot, ref, inRepoByName);
    committed.push(
      buildInstall(ref, "project", projectMap.get(ref) ?? false, installPath),
    );
  }

  const effective: PluginInstall[] = [];
  for (const ref of unionRefs) {
    let enabled: boolean;
    if (localMap.has(ref)) {
      enabled = localMap.get(ref) ?? false;
    } else if (projectMap.has(ref)) {
      enabled = projectMap.get(ref) ?? false;
    } else {
      enabled = userMap.get(ref) ?? false;
    }

    let scope: PluginScope;
    if (localMap.has(ref)) {
      scope = "local";
    } else if (projectMap.has(ref)) {
      scope = "project";
    } else {
      scope = "user";
    }

    const installPath = resolveInstallPath(homeRoot, ref, inRepoByName);
    effective.push(buildInstall(ref, scope, enabled, installPath));
  }

  return {
    scanned_at: new Date().toISOString(),
    committed,
    effective,
  };
}
