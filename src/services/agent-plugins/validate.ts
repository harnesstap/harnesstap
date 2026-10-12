import semver from "semver";
import { isValidApName } from "./name.js";
import { AP_SCHEMA_URL, lookupApSchema } from "./schema-registry.js";

export { AP_SCHEMA_URL } from "./schema-registry.js";

/** Agent Plugins 1.0 core fields. The schema is closed: nothing else is legal. */
const CORE_FIELDS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

export class ManifestValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid Agent Plugins manifest:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "ManifestValidationError";
    this.problems = problems;
  }
}

function isVerbose(): boolean {
  return process.argv.includes("-v") || process.argv.includes("--verbose");
}

/**
 * Read compat for `plugin.json` `$schema`, applied in memory only.
 *
 * - Missing or empty (catalog packages may omit it): default to the canonical URL.
 * - A legacy HarnessTap identifier: upgrade to the canonical URL.
 * - Anything else is left alone so validation can accept or reject it.
 *
 * Nothing is written back to disk. Only a later export emits the new value.
 */
export function withDefaultedApSchema(manifest: unknown): {
  manifest: unknown;
  defaulted: boolean;
  /** The legacy identifier that was replaced, when one was. */
  upgradedFrom?: string;
} {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { manifest, defaulted: false };
  }
  const document = manifest as Record<string, unknown>;
  const schema = document.$schema;
  if (typeof schema === "string" && schema.length > 0) {
    if (lookupApSchema(schema).kind === "legacy") {
      if (isVerbose()) {
        console.error(`plugin.json uses legacy $schema ${schema}; reading it as ${AP_SCHEMA_URL}`);
      }
      return {
        manifest: { ...document, $schema: AP_SCHEMA_URL },
        defaulted: false,
        upgradedFrom: schema,
      };
    }
    return { manifest, defaulted: false };
  }
  if (schema !== undefined && typeof schema !== "string") {
    return { manifest, defaulted: false };
  }
  if (isVerbose()) {
    console.error(`plugin.json is missing $schema; defaulting to ${AP_SCHEMA_URL}`);
  }
  return {
    manifest: { ...document, $schema: AP_SCHEMA_URL },
    defaulted: true,
  };
}

export function validateApManifest(manifest: unknown): void {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new ManifestValidationError(["manifest must be a JSON object"]);
  }
  const document = manifest as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(document)) {
    if (!CORE_FIELDS.has(key)) {
      problems.push(
        `unknown top-level field "${key}": HarnessTap fields belong under extensions["com.harnesstap"]`,
      );
    }
  }

  if (typeof document.$schema !== "string" || document.$schema.length === 0) {
    problems.push("$schema is required and must be a string");
  } else if (lookupApSchema(document.$schema).kind === "unsupported-spec") {
    problems.push(
      `unsupported Agent Plugins version: $schema "${document.$schema}" ` +
        `(this HarnessTap version reads ${AP_SCHEMA_URL})`,
    );
  }

  if (typeof document.name !== "string") {
    problems.push("name is required and must be a string");
  } else if (!isValidApName(document.name)) {
    problems.push(
      `name "${document.name}" violates the Agent Plugins name rules ` +
        "(1-64 chars, a-z0-9-. , alphanumeric first and last, no -- or ..)",
    );
  }

  if (typeof document.version !== "string") {
    problems.push("version is required and must be a string");
  } else if (semver.valid(document.version) === null) {
    problems.push(`version "${document.version}" is not a valid semantic version`);
  }

  if (document.description !== undefined && typeof document.description !== "string") {
    problems.push("description must be a string");
  }
  for (const key of ["homepage", "repository", "license"] as const) {
    if (document[key] !== undefined && typeof document[key] !== "string") {
      problems.push(`${key} must be a string`);
    }
  }
  if (
    document.keywords !== undefined &&
    (!Array.isArray(document.keywords) ||
      document.keywords.some((entry) => typeof entry !== "string"))
  ) {
    problems.push("keywords must be an array of strings");
  }
  if (document.author !== undefined) {
    const ok =
      typeof document.author === "string" ||
      (typeof document.author === "object" &&
        document.author !== null &&
        !Array.isArray(document.author));
    if (!ok) problems.push("author must be a string or an object");
  }
  if (
    document.extensions !== undefined &&
    (typeof document.extensions !== "object" ||
      document.extensions === null ||
      Array.isArray(document.extensions))
  ) {
    problems.push("extensions must be an object keyed by reverse-DNS namespace");
  }

  if (problems.length > 0) {
    throw new ManifestValidationError(problems);
  }
}
