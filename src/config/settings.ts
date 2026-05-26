import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessdeckSettings {
  plugins: { refreshMaxAgeHours: number };
}

const DEFAULTS: HarnessdeckSettings = {
  plugins: { refreshMaxAgeHours: 24 },
};

function parseJsonc(content: string): unknown {
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

export function loadSettings(harnessdeckDir: string): HarnessdeckSettings {
  const path = existsSync(join(harnessdeckDir, "config.jsonc"))
    ? join(harnessdeckDir, "config.jsonc")
    : join(harnessdeckDir, "config.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const raw = parseJsonc(readFileSync(path, "utf-8")) as Partial<HarnessdeckSettings>;
    const hours = raw.plugins?.refreshMaxAgeHours;
    return {
      plugins: {
        refreshMaxAgeHours:
          typeof hours === "number" && hours > 0
            ? hours
            : DEFAULTS.plugins.refreshMaxAgeHours,
      },
    };
  } catch {
    return DEFAULTS;
  }
}
