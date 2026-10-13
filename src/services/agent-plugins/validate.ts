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

export type ApManifestMode = "import" | "strict";

export interface ApManifestDiagnosis {
  /**
   * Manifest copy with reported fields removed.
   * Null when a fatal problem rejects the plugin.
   */
  manifest: Record<string, unknown> | null;
  fatal: string[];
  /** Unknown fields and a non-object `extensions` value (spec 1.0 import). */
  reported: string[];
}

const AUTHOR_FIELDS = new Set(["name", "email", "url"]);

function authorProblems(author: unknown): string[] {
  if (typeof author !== "object" || author === null || Array.isArray(author)) {
    return ["author must be an object with optional name, email, and url strings"];
  }
  const problems: string[] = [];
  for (const [key, value] of Object.entries(author as Record<string, unknown>)) {
    if (!AUTHOR_FIELDS.has(key)) {
      problems.push(`author.${key} is not allowed`);
    } else if (typeof value !== "string") {
      problems.push(`author.${key} must be a string`);
    }
  }
  return problems;
}

/**
 * Manifest check for Agent Plugins 1.0.0.
 *
 * `import` follows the spec: unknown top-level fields and a non-object
 * `extensions` value are reported and ignored, `version` may be omitted or
 * non-semver, and every other violation rejects the plugin.
 * `strict` is the publish and authoring lint: those reported cases are fatal,
 * and `version` must be semver.
 */
export function diagnoseApManifest(
  manifest: unknown,
  mode: ApManifestMode,
): ApManifestDiagnosis {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { manifest: null, fatal: ["manifest must be a JSON object"], reported: [] };
  }
  const document = { ...(manifest as Record<string, unknown>) };
  const fatal: string[] = [];
  const reported: string[] = [];

  for (const key of Object.keys(document)) {
    if (CORE_FIELDS.has(key)) continue;
    const message =
      mode === "strict"
        ? `unknown top-level field "${key}": HarnessTap fields belong under extensions["com.harnesstap"]`
        : `unknown top-level field "${key}" reported and ignored`;
    if (mode === "strict") fatal.push(message);
    else reported.push(message);
    delete document[key];
  }

  if (typeof document.$schema !== "string" || document.$schema.length === 0) {
    fatal.push("$schema is required and must be a string");
  } else {
    const lookup = lookupApSchema(document.$schema);
    if (lookup.kind === "unsupported-spec") {
      fatal.push(
        `unsupported Agent Plugins version: $schema "${document.$schema}" ` +
          `(this HarnessTap version reads ${AP_SCHEMA_URL})`,
      );
    } else if (lookup.kind !== "current") {
      fatal.push(
        `$schema "${document.$schema}" is not a supported Agent Plugins manifest ` +
          `(this HarnessTap version reads ${AP_SCHEMA_URL})`,
      );
    }
  }

  if (typeof document.name !== "string") {
    fatal.push("name is required and must be a string");
  } else if (!isValidApName(document.name)) {
    fatal.push(
      `name "${document.name}" violates the Agent Plugins name rules ` +
        "(1-64 chars, a-z0-9-. , alphanumeric first and last, no -- or ..)",
    );
  }

  if (document.version === undefined) {
    if (mode === "strict") fatal.push("version is required and must be a string");
  } else if (typeof document.version !== "string") {
    fatal.push("version is required and must be a string");
  } else if (mode === "strict" && semver.valid(document.version) === null) {
    fatal.push(`version "${document.version}" is not a valid semantic version`);
  } else if (document.version.length === 0 && mode === "import") {
    delete document.version;
  }

  if (document.description !== undefined && typeof document.description !== "string") {
    fatal.push("description must be a string");
  }
  for (const key of ["homepage", "repository", "license"] as const) {
    if (document[key] !== undefined && typeof document[key] !== "string") {
      fatal.push(`${key} must be a string`);
    }
  }
  if (
    document.keywords !== undefined &&
    (!Array.isArray(document.keywords) ||
      document.keywords.some((entry) => typeof entry !== "string"))
  ) {
    fatal.push("keywords must be an array of strings");
  }
  if (document.author !== undefined) {
    fatal.push(...authorProblems(document.author));
  }
  if (document.extensions !== undefined) {
    const extensionsOk =
      typeof document.extensions === "object" &&
      document.extensions !== null &&
      !Array.isArray(document.extensions);
    if (!extensionsOk) {
      const message = "extensions must be an object keyed by reverse-DNS namespace";
      if (mode === "strict") fatal.push(message);
      else {
        reported.push("extensions is not an object; reported and ignored");
        delete document.extensions;
      }
    }
  }

  if (fatal.length > 0) {
    return { manifest: null, fatal, reported };
  }
  return { manifest: document, fatal, reported };
}

/** Publish and authoring lint. Import uses `diagnoseApManifest(..., "import")`. */
export function validateApManifest(manifest: unknown): void {
  const diagnosis = diagnoseApManifest(manifest, "strict");
  const problems = [...diagnosis.fatal, ...diagnosis.reported];
  if (problems.length > 0) {
    throw new ManifestValidationError(problems);
  }
}
