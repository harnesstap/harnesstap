import semver from "semver";
import { isValidApName } from "./name.js";

export const AP_SCHEMA_URL = "https://agentplugins.org/schema/v1/plugin.schema.json";

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

export function validateApManifest(manifest: unknown): void {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new ManifestValidationError(["manifest must be a JSON object"]);
  }
  const document = manifest as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(document)) {
    if (!CORE_FIELDS.has(key)) {
      problems.push(
        `unknown top-level field "${key}" — HarnessTap fields belong under extensions["com.harnesstap"]`,
      );
    }
  }

  if (typeof document.$schema !== "string" || document.$schema.length === 0) {
    problems.push("$schema is required and must be a string");
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
