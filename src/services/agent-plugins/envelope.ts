import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertContainedPath, PathEscapeError } from "../../utils/path-containment.js";
import { AP_PACKAGE_SCHEMA, type ApPackageFiles } from "./files.js";

export const AP_ENVELOPE_EXTENSION = ".ap.json";

export interface ApEnvelope {
  schema: typeof AP_PACKAGE_SCHEMA;
  files: ApPackageFiles;
}

export function isApEnvelopePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(AP_ENVELOPE_EXTENSION);
}

/** Sorted keys and stable indentation so the same plugin yields the same bytes. */
export function envelopeFromFiles(files: ApPackageFiles): ApEnvelope {
  const sorted: ApPackageFiles = {};
  for (const path of Object.keys(files).sort()) {
    const entry = files[path];
    if (entry) sorted[path] = entry;
  }
  return { schema: AP_PACKAGE_SCHEMA, files: sorted };
}

export function writeApEnvelope(files: ApPackageFiles, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(envelopeFromFiles(files), null, 2)}\n`, "utf8");
}

export function readApEnvelope(inputPath: string): ApPackageFiles {
  return parseApEnvelope(readFileSync(inputPath, "utf8"), inputPath);
}

export function parseApEnvelope(raw: string, label: string): ApPackageFiles {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error(`${label} must be a JSON object`);
  }

  const envelope = document as { schema?: unknown; files?: unknown };
  if (envelope.schema !== AP_PACKAGE_SCHEMA) {
    throw new Error(
      `${label} declares schema ${String(envelope.schema)}; expected ${AP_PACKAGE_SCHEMA}`,
    );
  }
  if (
    typeof envelope.files !== "object" ||
    envelope.files === null ||
    Array.isArray(envelope.files)
  ) {
    throw new Error(`${label} must have a files object`);
  }

  const files: ApPackageFiles = {};
  for (const [path, value] of Object.entries(envelope.files as Record<string, unknown>)) {
    // The envelope is untrusted input; a `..` key must not become a write path.
    // Reject raw `..` segments even when resolve() would keep the path inside the root
    // (e.g. skills/../escape/SKILL.md → escape/SKILL.md).
    if (path.split("/").includes("..")) {
      throw new PathEscapeError(path, ".");
    }
    assertContainedPath(".", path);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${label}: entry ${path} must be an object`);
    }
    const entry = value as { encoding?: unknown; content?: unknown };
    if (entry.encoding !== "utf8" && entry.encoding !== "base64") {
      throw new Error(
        `${label}: entry ${path} has unsupported encoding ${String(entry.encoding)}`,
      );
    }
    if (typeof entry.content !== "string") {
      throw new Error(`${label}: entry ${path} must have string content`);
    }
    files[path] = { encoding: entry.encoding, content: entry.content };
  }
  return files;
}
