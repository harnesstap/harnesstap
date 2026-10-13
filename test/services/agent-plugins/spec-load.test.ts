import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { isValidApName } from "../../../src/services/agent-plugins/name.ts";
import { AP_SCHEMA_URL } from "../../../src/services/agent-plugins/schema-registry.ts";
import { loadSpecPackagePath } from "../../../src/services/agent-plugins/spec-load.ts";
import { diagnoseApManifest } from "../../../src/services/agent-plugins/validate.ts";

const ROOT = join(import.meta.dirname, "../../fixtures/agent-plugins-spec/conformance");

const NAME_VALID = ["my-plugin", "acme.tools", "lint3r", "a"];
const NAME_INVALID = ["My-Plugin", "-start", "has--double", "too.many..dots", ""];

describe("Agent Plugins name vectors", () => {
  it("accepts the spec examples and rejects the invalid ones", () => {
    for (const name of NAME_VALID) expect(isValidApName(name)).toBe(true);
    for (const name of NAME_INVALID) expect(isValidApName(name)).toBe(false);
  });
});

describe("spec import diagnostics", () => {
  it("reports unknown fields and a non-object extensions value, and keeps loading", () => {
    const diagnosis = diagnoseApManifest(
      {
        $schema: AP_SCHEMA_URL,
        name: "agent-plugins-conformance-recovery",
        version: "0.1.0",
        conformanceUnknown: true,
        extensions: false,
      },
      "import",
    );
    expect(diagnosis.fatal).toEqual([]);
    expect(diagnosis.manifest?.conformanceUnknown).toBeUndefined();
    expect(diagnosis.manifest?.extensions).toBeUndefined();
    expect(diagnosis.reported.join("\n")).toContain("conformanceUnknown");
    expect(diagnosis.reported.join("\n")).toContain("extensions");
  });

  it("accepts a missing or non-semver version on import and rejects it when publishing", () => {
    const missing = diagnoseApManifest({ $schema: AP_SCHEMA_URL, name: "my-plugin" }, "import");
    expect(missing.fatal).toEqual([]);
    expect(missing.manifest?.version).toBeUndefined();
    const dated = diagnoseApManifest(
      { $schema: AP_SCHEMA_URL, name: "my-plugin", version: "2024.1" },
      "import",
    );
    expect(dated.fatal).toEqual([]);
    expect(dated.manifest?.version).toBe("2024.1");
    expect(
      diagnoseApManifest({ $schema: AP_SCHEMA_URL, name: "my-plugin" }, "strict").fatal.join("\n"),
    ).toContain("version");
    expect(
      diagnoseApManifest(
        { $schema: AP_SCHEMA_URL, name: "my-plugin", version: "2024.1" },
        "strict",
      ).fatal.join("\n"),
    ).toContain("semantic version");
  });
});

describe("vendored conformance fixtures", () => {
  it("loads the core skills and every core MCP server", () => {
    const report = loadSpecPackagePath(join(ROOT, "agent-plugins-conformance-core"));
    expect(report.ok).toBe(true);
    expect(report.name).toBe("agent-plugins-conformance-core");
    expect(report.loaded.skills).toEqual(["conformance-alpha", "conformance-beta"]);
    expect(report.loaded.skills).not.toContain("conformance-nested");
    expect(report.loaded.skills).not.toContain("without-skill");
    expect(report.loaded.mcpServers).toEqual([
      "command-token-posix",
      "command-token-windows",
      "data",
      "default",
      "http",
      "http-redirect",
      "relative",
      "root",
      "sse",
      "sse-endpoint-origin",
      "sse-header-precedence",
      "sse-redirect",
    ]);
    expect(report.skipped).toEqual([]);
    expect(report.mcpDisabled).toBeUndefined();
  });

  it("loads the recovery skill and only the valid MCP server", () => {
    const report = loadSpecPackagePath(join(ROOT, "agent-plugins-conformance-recovery"));
    expect(report.ok).toBe(true);
    expect(report.loaded.skills).toEqual(["conformance-recovery-valid"]);
    expect(report.loaded.mcpServers).toEqual(["recovery-valid"]);
    expect(report.skipped.map((item) => item.name).sort()).toEqual(
      [
        "conformance-recovery-invalid",
        "recovery-command-symlink-posix",
        "recovery-command-symlink-windows",
        "recovery-cwd-data-escape",
        "recovery-cwd-escape",
        "recovery-cwd-invalid-form",
        "recovery-cwd-symlink-escape",
        "recovery-env-plugin-data",
        "recovery-env-plugin-root",
        "recovery-http-duplicate-headers",
        "recovery-http-fragment",
        "recovery-http-header-name",
        "recovery-http-header-value",
        "recovery-http-non-loopback",
        "recovery-http-relative-url",
        "recovery-http-type",
        "recovery-http-userinfo",
        "recovery-invalid",
        "recovery-missing-type",
        "recovery-sse-duplicate-headers",
        "recovery-sse-fragment",
        "recovery-sse-header-name",
        "recovery-sse-header-value",
        "recovery-sse-non-loopback",
        "recovery-sse-relative-url",
        "recovery-sse-userinfo",
        "recovery-unknown-field",
      ].sort(),
    );
    const reported = report.reported.map((item) => item.field).sort();
    expect(reported).toEqual(["conformanceUnknown", "extensions"]);
    expect(report.mcpDisabled).toBeUndefined();
  });

  it("loads the invalid-mcp skill and disables MCP", () => {
    const report = loadSpecPackagePath(join(ROOT, "agent-plugins-conformance-invalid-mcp"));
    expect(report.ok).toBe(true);
    expect(report.loaded.skills).toEqual(["conformance-invalid-mcp-valid"]);
    expect(report.loaded.mcpServers).toEqual([]);
    expect(report.mcpDisabled).toContain("JSON");
  });
});
