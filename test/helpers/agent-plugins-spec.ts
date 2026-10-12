import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";

/**
 * Official Agent Plugins JSON Schemas, vendored under
 * test/fixtures/agent-plugins-spec (see UPSTREAM.md). Loaded from disk only:
 * the guard never fetches a schema. ajv is a devDependency; nothing under
 * src/ may import it.
 */
export const AP_SPEC_SCHEMA_DIR = join(import.meta.dirname, "../fixtures/agent-plugins-spec/schemas");

export type ApSpecDocument = "plugin" | "mcp";

const cache = new Map<string, ValidateFunction>();

function loadSchema(version: string, document: ApSpecDocument): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(AP_SPEC_SCHEMA_DIR, version, `${document}.schema.json`), "utf8"),
  ) as Record<string, unknown>;
}

export function specValidator(document: ApSpecDocument, version = "1.0.0"): ValidateFunction {
  const key = `${version}/${document}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(loadSchema(version, document));
  cache.set(key, validate);
  return validate;
}

/** Schema errors for `value`, one readable line each. Empty when valid. */
export function specErrors(document: ApSpecDocument, value: unknown, version = "1.0.0"): string[] {
  const validate = specValidator(document, version);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (error) =>
      `${document}.json${error.instancePath || ""} ${error.message ?? "is invalid"}` +
      (error.params && Object.keys(error.params).length > 0
        ? ` ${JSON.stringify(error.params)}`
        : ""),
  );
}
