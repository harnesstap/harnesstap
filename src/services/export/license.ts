import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { SPDX_EXCEPTION_IDS, SPDX_LICENSE_IDS } from "./spdx-ids.js";

export const LICENSE_KIND_ID = "id" as const;
export const LICENSE_KIND_EXPRESSION = "expression" as const;
export const LICENSE_KIND_NAMED = "named" as const;

export type LicenseKind =
  | typeof LICENSE_KIND_ID
  | typeof LICENSE_KIND_EXPRESSION
  | typeof LICENSE_KIND_NAMED;

export interface LicenseClass {
  kind: LicenseKind;
  value: string;
}

const OPERATORS = new Set(["AND", "OR"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanLicense(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const stripped = value.trim();
  return stripped.length > 0 ? stripped : undefined;
}

function fromApmYml(path: string): string | undefined {
  try {
    const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) {
      return undefined;
    }
    return cleanLicense(parsed.license);
  } catch {
    return undefined;
  }
}

function fromPluginJson(path: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) {
      return undefined;
    }
    return cleanLicense(parsed.license);
  } catch {
    return undefined;
  }
}

/**
 * Read the declared license from a dependency manifest (`license:` in `apm.yml`,
 * else `license` in `plugin.json`). Never reads LICENSE file text.
 */
function manifestSearchRoot(installPath: string): string {
  try {
    return lstatSync(installPath).isDirectory() ? installPath : dirname(installPath);
  } catch {
    return installPath;
  }
}

export function readDeclaredLicense(installPath: string): string | undefined {
  const base = manifestSearchRoot(installPath);

  const apmYml = join(base, "apm.yml");
  if (existsSync(apmYml)) {
    const declared = fromApmYml(apmYml);
    if (declared !== undefined) {
      return declared;
    }
  }

  const pluginJson = join(base, "plugin.json");
  if (existsSync(pluginJson)) {
    return fromPluginJson(pluginJson);
  }

  return undefined;
}

function isLicenseRef(token: string): boolean {
  return token.startsWith("LicenseRef-") || token.startsWith("DocumentRef-");
}

function isValidLicenseId(token: string): boolean {
  const bare = token.endsWith("+") ? token.slice(0, -1) : token;
  return Boolean(bare) && (SPDX_LICENSE_IDS.has(bare) || isLicenseRef(token));
}

function tokenize(text: string): string[] {
  return text.replaceAll("(", " ( ").replaceAll(")", " ) ").split(/\s+/).filter(Boolean);
}

function hasExpressionSyntax(tokens: string[]): boolean {
  return tokens.some(
    (token) => token === "(" || token === ")" || OPERATORS.has(token.toUpperCase()) || token.toUpperCase() === "WITH",
  );
}

class ExpressionParser {
  private pos = 0;

  constructor(private readonly tokens: string[]) {}

  parse(): boolean {
    if (!this.parseOr()) {
      return false;
    }
    return this.pos === this.tokens.length;
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private advance(): string | undefined {
    const token = this.peek();
    if (token !== undefined) {
      this.pos += 1;
    }
    return token;
  }

  private parseOr(): boolean {
    if (!this.parseUnit()) {
      return false;
    }
    let next = this.peek();
    while (next !== undefined && OPERATORS.has(next.toUpperCase())) {
      this.advance();
      if (!this.parseUnit()) {
        return false;
      }
      next = this.peek();
    }
    return true;
  }

  private parseUnit(): boolean {
    const token = this.peek();
    if (token === undefined) {
      return false;
    }
    if (token === "(") {
      this.advance();
      if (!this.parseOr()) {
        return false;
      }
      return this.advance() === ")";
    }
    if (token === ")" || OPERATORS.has(token) || token.toUpperCase() === "WITH") {
      return false;
    }
    this.advance();
    if (!isValidLicenseId(token)) {
      return false;
    }
    const next = this.peek();
    if (next !== undefined && next.toUpperCase() === "WITH") {
      this.advance();
      const exception = this.advance();
      return exception !== undefined && SPDX_EXCEPTION_IDS.has(exception);
    }
    return true;
  }
}

/**
 * Classify a non-empty declared license for CycloneDX rendering.
 * SPDX `licenseDeclared` always uses the verbatim string.
 */
export function classifyDeclaredLicense(declared: string): LicenseClass {
  const value = declared.trim();
  if (!value) {
    return { kind: LICENSE_KIND_NAMED, value };
  }
  if (value.toUpperCase() === "UNLICENSED" || value.toUpperCase().startsWith("SEE LICENSE IN ")) {
    return { kind: LICENSE_KIND_NAMED, value };
  }

  const tokens = tokenize(value);
  if (!hasExpressionSyntax(tokens)) {
    if (tokens.length === 1 && tokens[0] && isValidLicenseId(tokens[0])) {
      return { kind: LICENSE_KIND_ID, value };
    }
    return { kind: LICENSE_KIND_NAMED, value };
  }

  if (new ExpressionParser(tokens).parse()) {
    return { kind: LICENSE_KIND_EXPRESSION, value };
  }
  return { kind: LICENSE_KIND_NAMED, value };
}
