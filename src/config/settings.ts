import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PluginMarketplacePlatform = "claude-code" | "cursor" | "goose";

export interface PluginMarketplaceEntry {
  name: string;
  url: string;
  platforms: PluginMarketplacePlatform[];
}

export interface HarnesstapSettings {
  plugins: {
    refreshMaxAgeHours: number;
    marketplaces: PluginMarketplaceEntry[];
  };
  layerVersionHistoryLimit: number;
}

const VALID_PLATFORMS = new Set<PluginMarketplacePlatform>([
  "claude-code",
  "cursor",
  "goose",
]);

const DEFAULTS: HarnesstapSettings = {
  plugins: { refreshMaxAgeHours: 24, marketplaces: [] },
  layerVersionHistoryLimit: 10,
};

function isPluginMarketplacePlatform(
  value: unknown,
): value is PluginMarketplacePlatform {
  return (
    typeof value === "string" &&
    VALID_PLATFORMS.has(value as PluginMarketplacePlatform)
  );
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

    if (typeof name !== "string" || name.length === 0) continue;
    if (typeof url !== "string" || url.length === 0) continue;
    if (!Array.isArray(platforms)) continue;

    const parsedPlatforms = platforms.filter(isPluginMarketplacePlatform);
    if (parsedPlatforms.length === 0) continue;

    marketplaces.push({ name, url, platforms: parsedPlatforms });
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
  const path = existsSync(join(harnesstapDir, "config.jsonc"))
    ? join(harnesstapDir, "config.jsonc")
    : join(harnesstapDir, "config.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const raw = parseJsonc(readFileSync(path, "utf-8")) as Partial<HarnesstapSettings>;
    const hours = raw.plugins?.refreshMaxAgeHours;
    const limit = raw.layerVersionHistoryLimit;
    return {
      plugins: {
        refreshMaxAgeHours:
          typeof hours === "number" && hours > 0
            ? hours
            : DEFAULTS.plugins.refreshMaxAgeHours,
        marketplaces: parseMarketplaces(raw.plugins?.marketplaces),
      },
      layerVersionHistoryLimit:
        typeof limit === "number" && Number.isInteger(limit) && limit >= 1
          ? limit
          : DEFAULTS.layerVersionHistoryLimit,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(
  harnesstapDir: string,
  settings: HarnesstapSettings,
): void {
  const path = existsSync(join(harnesstapDir, "config.jsonc"))
    ? join(harnesstapDir, "config.jsonc")
    : join(harnesstapDir, "config.json");
  mkdirSync(harnesstapDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}
