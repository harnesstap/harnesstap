import { extname } from "node:path";

const LEGACY_EXTENSIONS = new Set([".json", ".jsonc"]);

export function assertTransportExtension(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  if (LEGACY_EXTENSIONS.has(extension)) {
    throw new Error(
      "JSON transport was removed. Re-export with `ht migrate export --layer <name>` or `ht migrate export <archive> --workspace` to produce TOML.",
    );
  }
  if (extension !== ".toml") {
    throw new Error(
      `Expected a TOML transport file (.toml): ${filePath}`,
    );
  }
}

export function readSchemaHeader(
  document: Record<string, unknown>,
): { schema: string; version: number } {
  const schema = document.schema;
  const version = document.version;
  if (typeof schema !== "string" || schema.length === 0) {
    throw new Error("Transport file must include a non-empty schema string");
  }
  if (typeof version !== "number") {
    throw new Error("Transport file must include a numeric version");
  }
  return { schema, version };
}
