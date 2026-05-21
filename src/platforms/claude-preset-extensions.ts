import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ClaudePresetConfig, SerializedFile } from "../types.js";

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
 * Merge Claude marketplace and plugin preset config into serialized files.
 */
export function applyClaudePresetExtensions(
  files: SerializedFile[],
  config: ClaudePresetConfig | undefined,
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
    const enabledPlugins = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    for (const plugin of config.plugins) {
      enabledPlugins[plugin.id] = plugin.enabled !== false;
    }
    settings.enabledPlugins = enabledPlugins;
  }

  const settingsContent = JSON.stringify(settings, null, 2);
  const withoutSettings = files.filter((file) => file.path !== SETTINGS_PATH);
  const existingSettings = files.find((file) => file.path === SETTINGS_PATH);

  if (existingSettings) {
    try {
      const generated = JSON.parse(existingSettings.content) as Record<string, unknown>;
      const merged = { ...generated, ...settings };
      return [
        ...withoutSettings,
        { path: SETTINGS_PATH, content: JSON.stringify(merged, null, 2) },
      ];
    } catch {
      return [...withoutSettings, { path: SETTINGS_PATH, content: settingsContent }];
    }
  }

  return [...withoutSettings, { path: SETTINGS_PATH, content: settingsContent }];
}
