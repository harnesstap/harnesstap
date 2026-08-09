import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnesstapSettings {
  plugins: { refreshMaxAgeHours: number };
  layerVersionHistoryLimit: number;
}

const DEFAULTS: HarnesstapSettings = {
  plugins: { refreshMaxAgeHours: 24 },
  layerVersionHistoryLimit: 10,
};

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
