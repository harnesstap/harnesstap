import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginPinMetadata, ResourceCreateInput } from "../types.js";
import type { PluginInstall } from "./types.js";
import { parsePluginRef, readJsonFile } from "./claude-installed.js";

const COPILOT_INSTALLED_PLUGINS_SOURCE = "~/.copilot/installed-plugins/";

const COPILOT_MANIFEST_PATHS = [
  ".claude-plugin/plugin.json",
  ".github/plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".goose-plugin/plugin.json",
  "plugin.json",
];

interface CopilotPluginManifest {
  name?: string;
  version?: string;
  description?: string;
  repository?: string;
  homepage?: string;
}

interface CopilotSettingsFile {
  enabledPlugins?: unknown;
}

export function copilotInstalledPluginsDir(homeRoot: string): string {
  return join(homeRoot, ".copilot", "installed-plugins");
}

function listDirNames(dirPath: string): string[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readCopilotManifest(installPath: string): CopilotPluginManifest | null {
  for (const relativePath of COPILOT_MANIFEST_PATHS) {
    const manifest = readJsonFile<CopilotPluginManifest>(
      join(installPath, relativePath),
    );
    if (manifest?.name) {
      return manifest;
    }
  }
  return null;
}

function normalizeEnabledPlugins(raw: unknown): Map<string, boolean> {
  const enabled = new Map<string, boolean>();
  if (raw == null) return enabled;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "boolean") enabled.set(key, value);
    }
  }
  return enabled;
}

function readEnabledPlugins(homeRoot: string): Map<string, boolean> {
  const settings = readJsonFile<CopilotSettingsFile>(
    join(homeRoot, ".copilot", "settings.json"),
  );
  return normalizeEnabledPlugins(settings?.enabledPlugins);
}

export function getInstalledCopilotPluginInstallPath(
  homeRoot: string,
  ref: string,
): string | null {
  const { name, marketplace } = parsePluginRef(ref);
  if (!marketplace) return null;
  const installPath = join(
    copilotInstalledPluginsDir(homeRoot),
    marketplace,
    name,
  );
  if (!existsSync(installPath) || !readCopilotManifest(installPath)) {
    return null;
  }
  return installPath;
}

export function loadInstalledCopilotPlugins(homeRoot: string): PluginInstall[] {
  const root = copilotInstalledPluginsDir(homeRoot);
  const enabledMap = readEnabledPlugins(homeRoot);
  const installs: PluginInstall[] = [];

  for (const marketplace of listDirNames(root)) {
    const marketplaceDir = join(root, marketplace);
    for (const name of listDirNames(marketplaceDir)) {
      const installPath = join(marketplaceDir, name);
      const manifest = readCopilotManifest(installPath);
      if (!manifest) continue;

      const ref = `${name}@${marketplace}`;
      const version = manifest.version?.trim() || "unknown";
      installs.push({
        ref,
        platformId: "copilot-cli",
        name,
        version,
        versionSource: manifest.version ? "manifest" : "unknown",
        scope: "user",
        enabled: enabledMap.get(ref) ?? true,
        installPath,
        metadata: {
          description: manifest.description,
          repository: manifest.repository,
          homepage: manifest.homepage,
        },
      });
    }
  }

  return installs.sort((left, right) => left.ref.localeCompare(right.ref));
}

export function listInstalledCopilotPluginPinCreateInputs(
  homeRoot: string,
): ResourceCreateInput[] {
  return loadInstalledCopilotPlugins(homeRoot).map((install) => {
    const { marketplace } = parsePluginRef(install.ref);
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
      type: "plugin" as const,
      name: install.name,
      namespace: marketplace,
      description:
        install.metadata?.description?.trim() || `Plugin pin: ${install.ref}`,
      content: "{}",
      metadata,
      source: COPILOT_INSTALLED_PLUGINS_SOURCE,
      origin_kind: marketplace ? ("marketplace_link" as const) : ("manual" as const),
      origin_ref: install.ref,
    };
  });
}
