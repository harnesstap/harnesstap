import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseApEnvelope } from "../../../src/services/agent-plugins/envelope.ts";
import { parseApPackageFiles } from "../../../src/services/agent-plugins/import.ts";
import { AP_PACKAGE_SCHEMA } from "../../../src/services/agent-plugins/files.ts";
import { validateApManifest } from "../../../src/services/agent-plugins/validate.ts";
import { validateApPackagePath } from "../../../src/services/agent-plugins/validate-package.ts";

const repoRoot = join(import.meta.dirname, "../../..");
const schemaPath = join(repoRoot, "schemas/ap-package.v1.json");
const fixturesDir = join(repoRoot, "schemas/fixtures");

function goldenFixturePaths(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".ap.json"))
    .map((name) => join(fixturesDir, name))
    .sort();
}

function assertEnvelopeShape(document: unknown, label: string): void {
  expect(document, label).toBeTypeOf("object");
  expect(document).not.toBeNull();
  expect(Array.isArray(document)).toBe(false);
  const envelope = document as { schema?: unknown; files?: unknown };
  expect(envelope.schema, `${label} schema`).toBe(AP_PACKAGE_SCHEMA);
  expect(envelope.files, `${label} files`).toBeTypeOf("object");
  expect(envelope.files).not.toBeNull();
  expect(Array.isArray(envelope.files)).toBe(false);
  const files = envelope.files as Record<string, unknown>;
  expect(files["plugin.json"], `${label} plugin.json`).toBeDefined();
  for (const [path, value] of Object.entries(files)) {
    expect(value, `${label} ${path}`).toBeTypeOf("object");
    const entry = value as { encoding?: unknown; content?: unknown };
    expect(["utf8", "base64"]).toContain(entry.encoding);
    expect(entry.content).toBeTypeOf("string");
  }
}

describe("G2 catalog package contract", () => {
  it("ships a JSON Schema for the ap-package.v1 envelope", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties?: { schema?: { const?: string } };
      required?: string[];
    };
    expect(schema.required).toEqual(["schema", "files"]);
    expect(schema.properties?.schema?.const).toBe(AP_PACKAGE_SCHEMA);
  });

  it("parseApPackageFiles accepts every golden fixture, including one without $schema", () => {
    const paths = goldenFixturePaths();
    expect(paths.length).toBeGreaterThanOrEqual(2);
    let sawMissingSchema = false;
    for (const fixturePath of paths) {
      const raw = readFileSync(fixturePath, "utf8");
      const document = JSON.parse(raw) as unknown;
      assertEnvelopeShape(document, fixturePath);
      const files = parseApEnvelope(raw, fixturePath);
      const pluginJson = JSON.parse(files["plugin.json"]?.content ?? "{}") as {
        $schema?: unknown;
        name?: unknown;
      };
      if (typeof pluginJson.$schema !== "string" || pluginJson.$schema.length === 0) {
        sawMissingSchema = true;
      }
      const parsed = parseApPackageFiles(files);
      expect(parsed.name).toBeTypeOf("string");
      expect(parsed.version).toBeTypeOf("string");
    }
    expect(sawMissingSchema).toBe(true);
  });

  it("publish/authoring validation still rejects a package without $schema", () => {
    const missing = join(fixturesDir, "catalog-missing-schema.ap.json");
    expect(() => validateApPackagePath(missing, { strict: true })).toThrow(/\$schema/);
    const files = parseApEnvelope(readFileSync(missing, "utf8"), missing);
    const manifest = JSON.parse(files["plugin.json"]?.content ?? "{}") as unknown;
    expect(() => validateApManifest(manifest)).toThrow(/\$schema/);
    expect(() => parseApPackageFiles(files)).not.toThrow();
  });
});
