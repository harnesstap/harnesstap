import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PLUGIN_RESOURCE_MODE,
  isPluginResourceMode,
  type PluginResourceMode,
} from "../services/plugin-resource-mode.js";

export type PluginMarketplacePlatform =
  | "claude-code"
  | "cursor"
  | "goose"
  | "copilot-cli";

export interface PluginMarketplaceEntry {
  name: string;
  url: string;
  platforms: PluginMarketplacePlatform[];
  /** Extra git branches to catalog. Empty/omitted tracks only the default branch. */
  trackedBranches?: string[];
}

export type UpdateMode = "off" | "notify" | "install";
export type UpdateFrequency = "hourly" | "daily" | "weekly";

/** Upstream update checks (B3). Auto-install stays off unless the user picks it. */
export interface UpdateSettings {
  /** off: no background checks. notify: check and show updates. install: also install in-range minor and patch versions. */
  mode: UpdateMode;
  /** How often the Desktop sidecar checks upstreams. */
  frequency: UpdateFrequency;
  /** True once the one-time "Keep these up to date?" prompt was answered. */
  prompted: boolean;
}

export const UPDATE_MODES: readonly UpdateMode[] = ["off", "notify", "install"];
export const UPDATE_FREQUENCIES: readonly UpdateFrequency[] = ["hourly", "daily", "weekly"];

export const UPDATE_FREQUENCY_MS: Record<UpdateFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  mode: "notify",
  frequency: "daily",
  prompted: false,
};

export function isUpdateMode(value: unknown): value is UpdateMode {
  return typeof value === "string" && (UPDATE_MODES as readonly string[]).includes(value);
}

export function isUpdateFrequency(value: unknown): value is UpdateFrequency {
  return typeof value === "string" && (UPDATE_FREQUENCIES as readonly string[]).includes(value);
}

export function parseUpdateSettings(value: unknown): UpdateSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    mode: isUpdateMode(raw.mode) ? raw.mode : DEFAULT_UPDATE_SETTINGS.mode,
    frequency: isUpdateFrequency(raw.frequency) ? raw.frequency : DEFAULT_UPDATE_SETTINGS.frequency,
    prompted: raw.prompted === true,
  };
}

export interface HarnesstapSettings {
  plugins: {
    refreshMaxAgeHours: number;
    marketplaceRefreshMaxAgeMinutes: number;
    marketplaces: PluginMarketplaceEntry[];
  };
  pluginVersionHistoryLimit: number;
  harnessSync: {
    pluginResources: PluginResourceMode;
    /** When true, Codex and Copilot load Agent Plugins packages instead of the portable extract. */
    nativeAgentPlugins: boolean;
  };
  updates: UpdateSettings;
}

const VALID_PLATFORMS = new Set<PluginMarketplacePlatform>([
  "claude-code",
  "cursor",
  "goose",
  "copilot-cli",
]);

export const DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES = 60;

export function marketplaceRefreshMaxAgeMs(minutes: number): number {
  return minutes * 60 * 1000;
}

const DEFAULTS: HarnesstapSettings = {
  plugins: {
    refreshMaxAgeHours: 24,
    marketplaceRefreshMaxAgeMinutes: DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES,
    marketplaces: [],
  },
  pluginVersionHistoryLimit: 10,
  harnessSync: {
    pluginResources: DEFAULT_PLUGIN_RESOURCE_MODE,
    nativeAgentPlugins: false,
  },
  updates: DEFAULT_UPDATE_SETTINGS,
};

function isPluginMarketplacePlatform(
  value: unknown,
): value is PluginMarketplacePlatform {
  return (
    typeof value === "string" &&
    VALID_PLATFORMS.has(value as PluginMarketplacePlatform)
  );
}

export function parseTrackedBranches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const branches: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    branches.push(trimmed);
  }
  return branches;
}

export function settingsPath(harnesstapDir: string): string {
  return existsSync(join(harnesstapDir, "config.jsonc"))
    ? join(harnesstapDir, "config.jsonc")
    : join(harnesstapDir, "config.json");
}

export function parseMarketplaces(value: unknown): PluginMarketplaceEntry[] {
  if (!Array.isArray(value)) return [];

  const marketplaces: PluginMarketplaceEntry[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null) continue;

    const record = row as Record<string, unknown>;
    const name = record.name;
    const url = record.url;
    const platforms = record.platforms;

    if (typeof name !== "string") continue;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) continue;
    if (typeof url !== "string") continue;
    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0) continue;
    if (!Array.isArray(platforms)) continue;

    const parsedPlatforms = platforms.filter(isPluginMarketplacePlatform);
    if (parsedPlatforms.length === 0) continue;

    const trackedBranches = parseTrackedBranches(record.trackedBranches);
    marketplaces.push({
      name: trimmedName,
      url: trimmedUrl,
      platforms: parsedPlatforms,
      ...(trackedBranches.length > 0 ? { trackedBranches } : {}),
    });
  }

  return marketplaces;
}

export function parseJsonc(content: string): unknown {
  let normalized = "";
  let inString = false;
  let stringQuote = '"';
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        normalized += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      normalized += char;
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
      }
      continue;
    }

    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringQuote = char;
      normalized += char;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index++;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < content.length) {
        const lookaheadChar = content[lookahead];
        const lookaheadNextChar = content[lookahead + 1];

        if (lookaheadChar !== undefined && /\s/.test(lookaheadChar)) {
          lookahead++;
          continue;
        }

        if (lookaheadChar === "/" && lookaheadNextChar === "/") {
          lookahead += 2;
          while (lookahead < content.length && content[lookahead] !== "\n") {
            lookahead++;
          }
          continue;
        }

        if (lookaheadChar === "/" && lookaheadNextChar === "*") {
          lookahead += 2;
          while (
            lookahead < content.length &&
            !(content[lookahead] === "*" && content[lookahead + 1] === "/")
          ) {
            lookahead++;
          }
          lookahead += 2;
          continue;
        }

        if (lookaheadChar === "}" || lookaheadChar === "]") {
          break;
        }

        normalized += char;
        break;
      }

      if (lookahead >= content.length) {
        normalized += char;
      }
      continue;
    }

    normalized += char;
  }

  return JSON.parse(normalized);
}

export function loadSettings(harnesstapDir: string): HarnesstapSettings {
  const path = settingsPath(harnesstapDir);
  if (!existsSync(path)) return DEFAULTS;
  try {
    const raw = parseJsonc(readFileSync(path, "utf-8")) as Partial<HarnesstapSettings> & {
      harnessSync?: { pluginResources?: unknown; nativeAgentPlugins?: unknown };
    };
    const hours = raw.plugins?.refreshMaxAgeHours;
    const marketplaceMinutes = raw.plugins?.marketplaceRefreshMaxAgeMinutes;
    const limit = raw.pluginVersionHistoryLimit;
    const pluginResources = raw.harnessSync?.pluginResources;
    const nativeAgentPlugins = raw.harnessSync?.nativeAgentPlugins === true;
    return {
      plugins: {
        refreshMaxAgeHours:
          typeof hours === "number" && hours > 0
            ? hours
            : DEFAULTS.plugins.refreshMaxAgeHours,
        marketplaceRefreshMaxAgeMinutes:
          typeof marketplaceMinutes === "number" && marketplaceMinutes > 0
            ? marketplaceMinutes
            : DEFAULTS.plugins.marketplaceRefreshMaxAgeMinutes,
        marketplaces: parseMarketplaces(raw.plugins?.marketplaces),
      },
      pluginVersionHistoryLimit:
        typeof limit === "number" && Number.isInteger(limit) && limit >= 1
          ? limit
          : DEFAULTS.pluginVersionHistoryLimit,
      harnessSync: {
        pluginResources: isPluginResourceMode(pluginResources)
          ? pluginResources
          : DEFAULTS.harnessSync.pluginResources,
        nativeAgentPlugins,
      },
      updates: parseUpdateSettings((raw as { updates?: unknown }).updates),
    };
  } catch {
    return DEFAULTS;
  }
}

export function readToolkitConfigRecord(
  harnesstapDir: string,
  path = settingsPath(harnesstapDir),
): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = parseJsonc(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function writeToolkitConfigRecord(
  harnesstapDir: string,
  record: Record<string, unknown>,
  path = settingsPath(harnesstapDir),
): void {
  mkdirSync(harnesstapDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

export function saveSettings(
  harnesstapDir: string,
  settings: HarnesstapSettings,
): void {
  const path = settingsPath(harnesstapDir);
  const existing = readToolkitConfigRecord(harnesstapDir, path);
  writeToolkitConfigRecord(
    harnesstapDir,
    {
      ...existing,
      plugins: settings.plugins,
      pluginVersionHistoryLimit: settings.pluginVersionHistoryLimit,
      harnessSync: settings.harnessSync,
      updates: settings.updates,
    },
    path,
  );
}

export function loadUpdateSettings(harnesstapDir: string): UpdateSettings {
  return loadSettings(harnesstapDir).updates;
}

/**
 * Change only the `updates` keys. Every other key in config.jsonc is kept as
 * it is (the file is rewritten as JSON, like every other settings write).
 */
export function saveUpdateSettings(
  harnesstapDir: string,
  patch: Partial<UpdateSettings>,
): UpdateSettings {
  const path = settingsPath(harnesstapDir);
  const existing = readToolkitConfigRecord(harnesstapDir, path);
  const next = parseUpdateSettings({ ...parseUpdateSettings(existing.updates), ...patch });
  writeToolkitConfigRecord(harnesstapDir, { ...existing, updates: next }, path);
  return next;
}
