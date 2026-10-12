import { loadVerifiedPackageFiles } from "../apm-bundle.js";
import type { ApPackageFile, ApPackageFiles } from "./files.js";
import { parseApPackageFiles } from "./import.js";
import { validateApManifest, withDefaultedApSchema } from "./validate.js";

export interface ApPackageValidation {
  ok: true;
  name: string;
  sourceName: string;
  version: string;
  schemaDefaulted: boolean;
  /** Legacy HarnessTap `$schema` read as the canonical one, when present. */
  schemaUpgradedFrom?: string;
  /** The effective `$schema`, after defaulting or a legacy upgrade. */
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
    throw new Error("Invalid plugin.json: expected JSON");
  }
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
  const normalized = withDefaultedApSchema(rawManifest);
  if (opts?.strict) {
    // Strict still requires an authored `$schema`, but a legacy HarnessTap
    // identifier is read as the canonical one (read compat).
    validateApManifest(normalized.defaulted ? rawManifest : normalized.manifest);
  }
  const parsed = parseApPackageFiles(files);
  const effective = normalized.manifest as Record<string, unknown>;
  return {
    ok: true,
    name: parsed.name,
    sourceName: parsed.sourceName,
    version: parsed.version,
    schemaDefaulted: normalized.defaulted,
    ...(normalized.upgradedFrom ? { schemaUpgradedFrom: normalized.upgradedFrom } : {}),
    schema: typeof effective.$schema === "string" ? effective.$schema : "",
  };
}
