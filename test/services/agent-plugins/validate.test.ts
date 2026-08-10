import { describe, expect, it } from "bun:test";
import {
  AP_SCHEMA_URL,
  ManifestValidationError,
  validateApManifest,
} from "../../../src/services/agent-plugins/validate.ts";

function base(): Record<string, unknown> {
  return { $schema: AP_SCHEMA_URL, name: "my-plugin", version: "1.0.0" };
}

describe("validateApManifest", () => {
  it("accepts a minimal conforming manifest", () => {
    expect(() => validateApManifest(base())).not.toThrow();
  });

  it("requires $schema", () => {
    const manifest = base();
    delete manifest.$schema;
    expect(() => validateApManifest(manifest)).toThrow(/\$schema/);
  });

  it("requires name and version", () => {
    const withoutName = base();
    delete withoutName.name;
    expect(() => validateApManifest(withoutName)).toThrow(/name/);
    const withoutVersion = base();
    delete withoutVersion.version;
    expect(() => validateApManifest(withoutVersion)).toThrow(/version/);
  });

  it("enforces the §5.5 name constraints", () => {
    expect(() => validateApManifest({ ...base(), name: "My_Plugin" })).toThrow(/name/);
    expect(() => validateApManifest({ ...base(), name: "a--b" })).toThrow(/name/);
  });

  it("requires a semver version", () => {
    expect(() => validateApManifest({ ...base(), version: "1.0" })).toThrow(/version/);
  });

  it("is a closed schema: unknown top-level keys are rejected", () => {
    expect(() => validateApManifest({ ...base(), dependencies: [] })).toThrow(/unknown/i);
    expect(() => validateApManifest({ ...base(), harnesstapProfile: true })).toThrow(
      /unknown/i,
    );
  });

  it("accepts every AP core field", () => {
    expect(() =>
      validateApManifest({
        ...base(),
        description: "d",
        author: { name: "a" },
        homepage: "https://example.test",
        repository: "https://github.com/a/b",
        license: "Apache-2.0",
        keywords: ["x"],
        extensions: { "com.harnesstap": { schema: "urn:harnesstap:ap-extension:v1" } },
      }),
    ).not.toThrow();
  });

  it("rejects a non-object extensions value", () => {
    expect(() => validateApManifest({ ...base(), extensions: [] })).toThrow(/extensions/);
  });

  it("reports every problem at once", () => {
    let caught: unknown;
    try {
      validateApManifest({ name: "A_B", version: "x", nope: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ManifestValidationError);
    expect((caught as ManifestValidationError).problems.length).toBeGreaterThanOrEqual(4);
  });
});
