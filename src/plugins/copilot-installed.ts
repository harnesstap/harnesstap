import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ResourceCreateInput } from "../types.js";
import type { PluginInstall } from "./types.js";
import { parsePluginRef, readJsonFile } from "./claude-installed.js";
import { readFirstHostPluginManifest } from "./host-plugin-manifest.js";
import { pluginInstallToPinInput } from "./host-plugin-pins.js";

const COPILOT_INSTALLED_PLUGINS_SOURCE = "~/.copilot/installed-plugins/";

type CopilotPluginManifest = NonNullable<
  ReturnType<typeof readFirstHostPluginManifest>
>;

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
  return readFirstHostPluginManifest(installPath);
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
  return loadInstalledCopilotPlugins(homeRoot).map((install) =>
    pluginInstallToPinInput(install, COPILOT_INSTALLED_PLUGINS_SOURCE),
  );
}
