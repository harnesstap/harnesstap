import { describe, expect, it } from "bun:test";
import {
  AP_SCHEMA_URL,
  ManifestValidationError,
  validateApManifest,
  withDefaultedApSchema,
} from "../../../src/services/agent-plugins/validate.ts";
import {
  AP_LEGACY_SCHEMA_URLS,
  AP_SCHEMA_VERSIONS,
  isAgentPluginsSchemaId,
  lookupApSchema,
} from "../../../src/services/agent-plugins/schema-registry.ts";

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

  it("defaults a missing or empty $schema without rewriting a present URL", () => {
    expect(withDefaultedApSchema({ name: "hello", version: "1.0.0" })).toEqual({
      manifest: { name: "hello", version: "1.0.0", $schema: AP_SCHEMA_URL },
      defaulted: true,
    });
    expect(withDefaultedApSchema({ $schema: "", name: "hello", version: "1.0.0" }).defaulted).toBe(
      true,
    );
    const kept = { $schema: "https://example.test/plugin.json", name: "hello", version: "1.0.0" };
    expect(withDefaultedApSchema(kept)).toEqual({ manifest: kept, defaulted: false });
    expect(withDefaultedApSchema({ $schema: 1, name: "hello", version: "1.0.0" }).defaulted).toBe(
      false,
    );
  });

  it("emits the canonical Agent Plugins 1.0.0 identifier", () => {
    expect(AP_SCHEMA_URL).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(AP_SCHEMA_URL).toBe(AP_SCHEMA_VERSIONS["1.0.0"].plugin);
  });

  it("upgrades a legacy HarnessTap $schema on read, in memory only", () => {
    for (const legacy of AP_LEGACY_SCHEMA_URLS) {
      const original = { $schema: legacy, name: "hello", version: "1.0.0" };
      const result = withDefaultedApSchema(original);
      expect(result).toEqual({
        manifest: { $schema: AP_SCHEMA_URL, name: "hello", version: "1.0.0" },
        defaulted: false,
        upgradedFrom: legacy,
      });
      expect(original.$schema).toBe(legacy);
      expect(() => validateApManifest(result.manifest)).not.toThrow();
    }
  });

  it("rejects an Agent Plugins version this build does not know", () => {
    expect(() =>
      validateApManifest({
        ...base(),
        $schema: "https://agent-plugins.org/schemas/1.1.0/plugin.schema.json",
      }),
    ).toThrow(/unsupported Agent Plugins version/);
    expect(
      withDefaultedApSchema({
        $schema: "https://agent-plugins.org/schemas/1.1.0/plugin.schema.json",
        name: "hello",
        version: "1.0.0",
      }).upgradedFrom,
    ).toBeUndefined();
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

describe("Agent Plugins schema registry", () => {
  it("classifies $schema values by exact match", () => {
    expect(lookupApSchema("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json").kind).toBe(
      "current",
    );
    expect(lookupApSchema("https://agentplugins.org/schema/v1/plugin.schema.json").kind).toBe(
      "legacy",
    );
    expect(lookupApSchema("https://agentplugins.org/schemas/v1/plugin.json").kind).toBe("legacy");
    expect(lookupApSchema("https://agent-plugins.org/schemas/1.1.0/plugin.schema.json").kind).toBe(
      "unsupported-spec",
    );
    expect(lookupApSchema("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json ").kind).toBe(
      "unsupported-spec",
    );
    expect(lookupApSchema("https://example.test/plugin.json").kind).toBe("unknown");
  });

  it("recognizes Agent Plugins manifests, including legacy HarnessTap ones", () => {
    expect(isAgentPluginsSchemaId(AP_SCHEMA_VERSIONS["1.0.0"].plugin)).toBe(true);
    expect(isAgentPluginsSchemaId("https://agentplugins.org/schema/v1/plugin.schema.json")).toBe(true);
    expect(isAgentPluginsSchemaId("https://example.test/agent-plugins.json")).toBe(false);
    expect(isAgentPluginsSchemaId(undefined)).toBe(false);
  });
});
