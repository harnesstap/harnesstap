import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  getInstalledPluginRecord,
  type InstalledPluginsFile,
} from "../plugins/claude-installed.js";
import type { ClaudePluginConfig, SerializedFile } from "../types.js";

const SETTINGS_PATH = ".claude/settings.json";
const INSTALLED_PLUGINS_PATH = ".claude/plugins/installed_plugins.json";

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

function parseObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function generatedInstalledRefs(files: readonly SerializedFile[]): Set<string> {
  const raw = files.find((file) => file.path === INSTALLED_PLUGINS_PATH)?.content;
  const parsed = parseObject(raw) as unknown as InstalledPluginsFile;
  return new Set(Object.keys(parsed.plugins ?? {}));
}

function enabledPluginsRecord(value: unknown): Record<string, boolean> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, boolean>) };
  }
  return {};
}

/**
 * Merge Claude marketplace and plugin config into serialized files.
 * `enabledPlugins` is merged key by key and never replaces unrelated entries.
 * A pin this apply is writing into installed_plugins.json counts as installed
 * even before that file is flushed to disk.
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
  const generatedSettings = parseObject(
    files.find((file) => file.path === SETTINGS_PATH)?.content,
  );
  const pendingInstalls = generatedInstalledRefs(files);

  if (config.marketplaces && Object.keys(config.marketplaces).length > 0) {
    settings.extraKnownMarketplaces = mergeRecord(
      settings.extraKnownMarketplaces as Record<string, unknown> | undefined,
      config.marketplaces as Record<string, unknown>,
    );
  }

  if (config.plugins && config.plugins.length > 0) {
    const enabledPlugins = {
      ...enabledPluginsRecord(settings.enabledPlugins),
      ...enabledPluginsRecord(generatedSettings.enabledPlugins),
    };
    for (const plugin of config.plugins) {
      const installed =
        Boolean(getInstalledPluginRecord(projectRoot, plugin.id))
        || pendingInstalls.has(plugin.id);
      if (installed) {
        enabledPlugins[plugin.id] = plugin.enabled !== false;
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
        overlay.extraKnownMarketplaces = mergeRecord(
          generated.extraKnownMarketplaces as Record<string, unknown> | undefined,
          settings.extraKnownMarketplaces as Record<string, unknown>,
        );
      }
      if (hasEnabled) {
        overlay.enabledPlugins = mergeRecord(
          enabledPluginsRecord(generated.enabledPlugins),
          enabledPluginsRecord(settings.enabledPlugins),
        );
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
