import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getInstalledPluginRecord } from "../plugins/claude-installed.js";
import type { ClaudePluginConfig, SerializedFile } from "../types.js";

const SETTINGS_PATH = ".claude/settings.json";

function readExistingSettings(projectRoot: string): Record<string, unknown> {
  const fullPath = join(projectRoot, SETTINGS_PATH);
  if (!existsSync(fullPath)) return {};

  try {
    return JSON.parse(readFileSync(fullPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mergeRecord<T extends Record<string, unknown>>(
  base: T | undefined,
  patch: T,
): T {
  return { ...(base ?? {}), ...patch };
}

/**
 * Merge Claude marketplace and plugin config into serialized files.
 */
export function applyClaudePluginExtensions(
  files: SerializedFile[],
  config: ClaudePluginConfig | undefined,
  projectRoot: string,
): SerializedFile[] {
  if (!config || (!config.marketplaces && !config.plugins)) {
    return files;
  }

  const settings = readExistingSettings(projectRoot);

  if (config.marketplaces && Object.keys(config.marketplaces).length > 0) {
    settings.extraKnownMarketplaces = mergeRecord(
      settings.extraKnownMarketplaces as Record<string, unknown> | undefined,
      config.marketplaces as Record<string, unknown>,
    );
  }

  if (config.plugins && config.plugins.length > 0) {
    const enabledPlugins = {
      ...((settings.enabledPlugins as Record<string, boolean> | undefined) ?? {}),
    };
    for (const plugin of config.plugins) {
      if (getInstalledPluginRecord(projectRoot, plugin.id)) {
        enabledPlugins[plugin.id] = plugin.enabled !== false;
      } else {
        delete enabledPlugins[plugin.id];
      }
    }
    if (Object.keys(enabledPlugins).length > 0) {
      settings.enabledPlugins = enabledPlugins;
    } else {
      delete settings.enabledPlugins;
    }
  }

  const hasMarketplace =
    settings.extraKnownMarketplaces
    && typeof settings.extraKnownMarketplaces === "object"
    && Object.keys(settings.extraKnownMarketplaces as Record<string, unknown>).length > 0;
  const hasEnabled =
    settings.enabledPlugins
    && typeof settings.enabledPlugins === "object"
    && Object.keys(settings.enabledPlugins as Record<string, unknown>).length > 0;
  const withoutSettings = files.filter((file) => file.path !== SETTINGS_PATH);
  const existingSettings = files.find((file) => file.path === SETTINGS_PATH);

  if (existingSettings) {
    try {
      const generated = JSON.parse(existingSettings.content) as Record<string, unknown>;
      const overlay: Record<string, unknown> = { ...generated };
      if (hasMarketplace) {
        overlay.extraKnownMarketplaces = settings.extraKnownMarketplaces;
      }
      if (hasEnabled) {
        overlay.enabledPlugins = settings.enabledPlugins;
      } else {
        delete overlay.enabledPlugins;
      }
      return [
        ...withoutSettings,
        { path: SETTINGS_PATH, content: JSON.stringify(overlay, null, 2) },
      ];
    } catch {
      return [...withoutSettings, { path: SETTINGS_PATH, content: JSON.stringify(settings, null, 2) }];
    }
  }

  if (!hasMarketplace && !hasEnabled && Object.keys(settings).length === 0) {
    return files;
  }

  return [...withoutSettings, { path: SETTINGS_PATH, content: JSON.stringify(settings, null, 2) }];
}
