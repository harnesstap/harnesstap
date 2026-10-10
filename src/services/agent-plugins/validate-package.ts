import { loadVerifiedPackageFiles } from "../apm-bundle.js";
import type { ApPackageFile, ApPackageFiles } from "./files.js";
import { parseApPackageFiles } from "./import.js";
import { AP_SCHEMA_URL, validateApManifest } from "./validate.js";

export interface ApPackageValidation {
  ok: true;
  name: string;
  sourceName: string;
  version: string;
  schemaDefaulted: boolean;
  schema: string;
}

function fileText(entry: ApPackageFile): string {
  return entry.encoding === "base64"
    ? Buffer.from(entry.content, "base64").toString("utf8")
    : entry.content;
}

function readPluginJson(files: ApPackageFiles): unknown {
  const manifestEntry = files["plugin.json"];
  if (!manifestEntry) {
    throw new Error("Missing plugin.json: not an Agent Plugins package");
  }
  try {
    return JSON.parse(fileText(manifestEntry)) as unknown;
  } catch {
    throw new Error("Invalid plugin.json — expected JSON");
  }
}

function schemaWasDefaulted(manifest: unknown): boolean {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return false;
  }
  const schema = (manifest as Record<string, unknown>).$schema;
  return typeof schema !== "string" || schema.length === 0;
}

/**
 * Validate a catalog/download package (directory, zip, or `.ap.json`).
 * Missing `plugin.json` `$schema` is accepted unless `strict` is set
 * (publish/authoring rules).
 */
export function validateApPackagePath(
  filePath: string,
  opts?: { strict?: boolean },
): ApPackageValidation {
  const files = loadVerifiedPackageFiles(filePath);
  const rawManifest = readPluginJson(files);
  if (opts?.strict) {
    validateApManifest(rawManifest);
  }
  const parsed = parseApPackageFiles(files);
  const defaulted = schemaWasDefaulted(rawManifest);
  return {
    ok: true,
    name: parsed.name,
    sourceName: parsed.sourceName,
    version: parsed.version,
    schemaDefaulted: defaulted,
    schema: defaulted
      ? AP_SCHEMA_URL
      : typeof rawManifest === "object" &&
          rawManifest !== null &&
          !Array.isArray(rawManifest) &&
          typeof (rawManifest as Record<string, unknown>).$schema === "string"
        ? ((rawManifest as Record<string, unknown>).$schema as string)
        : AP_SCHEMA_URL,
  };
}
