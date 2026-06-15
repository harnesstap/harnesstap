import { readFileSync } from "node:fs";
import { parse, TomlError } from "smol-toml";
import { assertTransportExtension } from "./validate.js";

export function parseTransportToml(
  raw: string,
  label: string,
): Record<string, unknown> {
  try {
    const parsed = parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid ${label} TOML: expected a table at the document root`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(`Invalid ${label} TOML: ${error.message}`);
    }
    throw error;
  }
}

export function readTransportFile(filePath: string): string {
  assertTransportExtension(filePath);
  return readFileSync(filePath, "utf-8");
}
