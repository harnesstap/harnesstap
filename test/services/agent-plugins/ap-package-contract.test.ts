import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseApEnvelope } from "../../../src/services/agent-plugins/envelope.ts";
import { parseApPackageFiles } from "../../../src/services/agent-plugins/import.ts";
import { AP_PACKAGE_SCHEMA } from "../../../src/services/agent-plugins/files.ts";
import { validateApManifest } from "../../../src/services/agent-plugins/validate.ts";
import { validateApPackagePath } from "../../../src/services/agent-plugins/validate-package.ts";
import { createTestContext } from "../../helpers/db.ts";
import { runCli } from "../../helpers/cli.ts";
import { createCatalogFetchMock } from "../../helpers/catalog-fetch.ts";
import { readApFixture } from "../../helpers/ap-package-fixtures.ts";
import { initGitRepo } from "../../helpers/git.ts";

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

  it("applies engineering-foundation from a clean HOME against G2 catalog fixtures", async () => {
    const context = await createTestContext("g2-apply-engineering-foundation");
    try {
      await runCli(["init"]);
      initGitRepo(context.projectDir, "git@github.com:acme/demo.git");

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://harnesstap.com",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "engineering-foundation",
            name: "Engineering foundation",
            summary: "Shared baseline",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: ["foundation"],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "superpowers",
            name: "superpowers",
            summary: "Skills",
            latestVersion: "5.1.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "context7",
            name: "context7",
            summary: "Docs",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "confidence",
            name: "confidence",
            summary: "Nested",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
        packages: {
          "harnesstap-cloud/default/engineering-foundation@1.0.0":
            readApFixture("catalog-missing-schema.ap.json"),
          "harnesstap-cloud/default/superpowers@5.1.0":
            readApFixture("superpowers.ap.json"),
          "harnesstap-cloud/default/context7@1.0.0":
            readApFixture("context7.ap.json"),
          "harnesstap-cloud/default/confidence@1.0.0":
            readApFixture("confidence.ap.json"),
        },
      });

      const result = await runCli([
        "apply",
        "engineering-foundation",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        "No local version of superpowers",
      );
      expect(result.stdout).toContain(
        "Fetched harnesstap-cloud/engineering-foundation@1.0.0 from catalog",
      );
      expect(result.stdout).toContain("Fetched harnesstap-cloud/superpowers@5.1.0 from catalog");
      expect(result.stdout).toContain("Fetched harnesstap-cloud/context7@1.0.0 from catalog");
      expect(result.stdout).toContain("Fetched harnesstap-cloud/confidence@1.0.0 from catalog");
      expect(existsSync(join(context.projectDir, ".claude/skills/baseline/SKILL.md"))).toBe(true);
      expect(existsSync(join(context.projectDir, ".claude/skills/superpowers/SKILL.md"))).toBe(
        true,
      );
      expect(existsSync(join(context.projectDir, ".claude/skills/context7/SKILL.md"))).toBe(true);
      expect(existsSync(join(context.projectDir, ".claude/skills/confidence/SKILL.md"))).toBe(
        true,
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });
});
