/**
 * CI guard: everything HarnessTap exports as an Agent Plugins package must
 * validate against the official 1.0.0 JSON Schemas (vendored, never fetched).
 * Run on its own with `bun run check:agent-plugins-spec`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { writeTextFile } from "../../helpers/fs.ts";
import { specErrors } from "../../helpers/agent-plugins-spec.ts";
import { makeApEnvelope } from "../../helpers/ap-package-fixtures.ts";
import { addResourceToPlugin, createPlugin } from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import {
  type ApPackageFiles,
  buildApPackageFiles,
  buildApPackageFilesForResource,
} from "../../../src/services/agent-plugins/files.ts";
import { parseApEnvelope } from "../../../src/services/agent-plugins/envelope.ts";
import { AP_SCHEMA_URL } from "../../../src/services/agent-plugins/validate.ts";
import {
  AP_LEGACY_SCHEMA_URLS,
  AP_SCHEMA_VERSIONS,
} from "../../../src/services/agent-plugins/schema-registry.ts";
import { packProject } from "../../../src/services/apm-pack.ts";
import { addDependency } from "../../../src/services/plugin-dependency.ts";
import { readApPackageFiles } from "../../../src/services/agent-plugins/files.ts";

const repoRoot = join(import.meta.dirname, "../../..");

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-spec-guard-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function jsonFile(files: ApPackageFiles, path: string): unknown {
  const entry = files[path];
  if (!entry) throw new Error(`package has no ${path}`);
  const text =
    entry.encoding === "base64" ? Buffer.from(entry.content, "base64").toString("utf8") : entry.content;
  return JSON.parse(text) as unknown;
}

/** Validates every spec document in an exported package (top level only). */
function expectSpecPackage(files: ApPackageFiles, label: string): void {
  expect(specErrors("plugin", jsonFile(files, "plugin.json")), `${label} plugin.json`).toEqual([]);
}

function attach(pluginId: string, input: Parameters<typeof createResource>[0]): void {
  addResourceToPlugin(pluginId, createResource(input).id);
}

function seedPlugin(name: string): string {
  const plugin = createPlugin({ name, version: "1.2.0", description: "Guard fixture", tags: ["guard"] });
  attach(plugin.id, {
    type: "skill",
    name: "deploy",
    description: "Deployment workflow",
    content: "# Deploy\n",
    metadata: {},
    source: "test",
  });
  attach(plugin.id, {
    type: "mcp_server",
    name: "search",
    description: "",
    content: "",
    metadata: { transport: "stdio", command: "npx", args: ["-y", "search"], env: { MODE: "fast" } },
    source: "test",
  });
  attach(plugin.id, {
    type: "mcp_server",
    name: "remote",
    description: "",
    content: "",
    metadata: {
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { "X-Client": "harnesstap" },
    },
    source: "test",
  });
  attach(plugin.id, {
    type: "rule",
    name: "style",
    description: "Style rule",
    content: "Use tabs.",
    metadata: {},
    source: "test",
  });
  return plugin.id;
}

describe("Agent Plugins 1.0.0 schema guard", () => {
  it("vendors the official schemas for the version HarnessTap emits", () => {
    const dir = join(repoRoot, "test/fixtures/agent-plugins-spec/schemas/1.0.0");
    const plugin = JSON.parse(readFileSync(join(dir, "plugin.schema.json"), "utf8")) as {
      $id: string;
      properties: { $schema: { const: string } };
    };
    const mcp = JSON.parse(readFileSync(join(dir, "mcp.schema.json"), "utf8")) as {
      $id: string;
      properties: { $schema: { const: string } };
    };
    expect(plugin.$id).toBe(AP_SCHEMA_VERSIONS["1.0.0"].plugin);
    expect(plugin.properties.$schema.const).toBe(AP_SCHEMA_URL);
    expect(mcp.$id).toBe(AP_SCHEMA_VERSIONS["1.0.0"].mcp);
    expect(mcp.properties.$schema.const).toBe(AP_SCHEMA_VERSIONS["1.0.0"].mcp);
  });

  it("rejects the legacy HarnessTap identifiers (so a regression fails the guard)", () => {
    for (const legacy of AP_LEGACY_SCHEMA_URLS) {
      expect(specErrors("plugin", { $schema: legacy, name: "x" }).join("\n")).toContain("$schema");
    }
    expect(specErrors("plugin", { name: "x" }).join("\n")).toContain("$schema");
  });

  it("plugin export (migrate export --plugin, plugin publish) is spec-valid", () => {
    const files = buildApPackageFiles(seedPlugin("guard-plugin"));
    expectSpecPackage(files, "plugin export");
  });

  it("an embedded dependency package is spec-valid too", () => {
    const parentId = seedPlugin("guard-parent");
    seedPlugin("guard-child");
    addDependency(parentId, "guard-child", { embedOnExport: true });
    const files = buildApPackageFiles(parentId);
    expectSpecPackage(files, "embedding parent");
    const prefix = "com.harnesstap/embedded/guard-child/";
    const embedded: ApPackageFiles = {};
    for (const [path, entry] of Object.entries(files)) {
      if (path.startsWith(prefix)) embedded[path.slice(prefix.length)] = entry;
    }
    expectSpecPackage(embedded, "embedded child");
  });

  it("single-resource export (migrate export --resource) is spec-valid", () => {
    const resource = createResource({
      type: "skill",
      name: "Lint Fixer",
      description: "Fix lints",
      content: "# Fix\n",
      metadata: {},
      source: "test",
    });
    expectSpecPackage(buildApPackageFilesForResource(resource.id), "resource export");
  });

  it("ht pack output is spec-valid, synthesized or authored with a legacy $schema", () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      "name: guard-pack\nversion: \"1.0.0\"\ndescription: Pack guard\nauthor: Jane Doe\nlicense: MIT\n",
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "skills", "ship", "SKILL.md"),
      "---\nname: ship\ndescription: Ship it\n---\n# Ship\n",
    );
    const synthesized = packProject({ projectRoot: ctx.projectDir });
    expectSpecPackage(readApPackageFiles(synthesized.outputPath), "ht pack (synthesized)");

    const authoredPath = join(ctx.projectDir, "plugin.json");
    const authored = `${JSON.stringify(
      { $schema: AP_LEGACY_SCHEMA_URLS[0], name: "guard-pack", version: "1.0.0" },
      null,
      2,
    )}\n`;
    writeTextFile(authoredPath, authored);
    const packed = packProject({ projectRoot: ctx.projectDir, outputDir: "build-authored" });
    expectSpecPackage(readApPackageFiles(packed.outputPath), "ht pack (authored legacy)");
    // Read compat never rewrites the source file.
    expect(readFileSync(authoredPath, "utf8")).toBe(authored);
  });

  it("checked-in package fixtures that model current output are spec-valid", () => {
    const fixtureDirs = [join(repoRoot, "schemas/fixtures"), join(repoRoot, "test/fixtures/builtin-plugins")];
    let checked = 0;
    for (const dir of fixtureDirs) {
      for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".ap.json")).sort()) {
        // Legacy and missing-$schema fixtures exist on purpose (read compat).
        if (name.startsWith("legacy-") || name === "catalog-missing-schema.ap.json") continue;
        const path = join(dir, name);
        expectSpecPackage(parseApEnvelope(readFileSync(path, "utf8"), path), name);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    expectSpecPackage(parseApEnvelope(makeApEnvelope(), "makeApEnvelope"), "makeApEnvelope");
  });

  it("keeps ajv a devDependency that runtime code never imports", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.ajv).toBeUndefined();
    expect(pkg.devDependencies?.ajv).toBeDefined();
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && /from ["']ajv/.test(readFileSync(path, "utf8"))) {
          offenders.push(path);
        }
      }
    };
    walk(join(repoRoot, "src"));
    expect(offenders).toEqual([]);
  });
});
