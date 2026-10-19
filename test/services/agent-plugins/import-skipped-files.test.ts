import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPluginByName, getPluginResources } from "../../../src/models/plugin-model.ts";
import { loadSpecPackagePath } from "../../../src/services/agent-plugins/spec-load.ts";
import {
  ImportSkippedFilesError,
  importScopedMigration,
} from "../../../src/services/migrate-scope.ts";
import { runPluginDoctor } from "../../../src/services/plugin-doctor.ts";
import { createInitializedTestContext, type TestContext } from "../../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("import-skipped-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function writePackage(root: string, files: Record<string, string>): string {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

/** The three cases from the persona packages, next to one valid skill and command. */
function personaPackage(): string {
  return writePackage(join(ctx.projectDir, "persona"), {
    "plugin.json": JSON.stringify({
      name: "skip-repro",
      version: "1.0.0",
      description: "Skipped files repro",
      extensions: { "com.harnesstap": { sourceName: "Skip repro" } },
    }),
    "skills/good-skill/SKILL.md": "---\nname: good-skill\ndescription: A valid skill.\n---\n\nBody.\n",
    "skills/no-frontmatter/SKILL.md": "# no-frontmatter\n\nNo frontmatter here.\n",
    "skills/colon-desc/SKILL.md":
      "---\nname: colon-desc\ndescription: Use when: the user asks for a review\n---\n\nBody.\n",
    "rules/api-validation.md": "# api-validation\n",
    "mcp-servers/postgres-readonly.json": '{ "name": "postgres-readonly" }\n',
    "commands/run-migrations.md": "# run-migrations\n",
  });
}

describe("skipped package files", () => {
  it("names each skipped file with its path and a specific reason", () => {
    const report = loadSpecPackagePath(personaPackage());
    expect(report.loaded.skills).toEqual(["good-skill"]);
    const byPath = Object.fromEntries(report.skipped.map((item) => [item.path, item]));
    expect(Object.keys(byPath).sort()).toEqual([
      "mcp-servers/postgres-readonly.json",
      "rules/api-validation.md",
      "skills/colon-desc/SKILL.md",
      "skills/no-frontmatter/SKILL.md",
    ]);
    expect(byPath["skills/no-frontmatter/SKILL.md"]?.reason).toContain("has no YAML frontmatter");
    const yaml = byPath["skills/colon-desc/SKILL.md"]?.reason ?? "";
    expect(yaml).toContain("not valid YAML at line 3");
    expect(yaml).toContain('quote values that contain ": "');
    expect(byPath["rules/api-validation.md"]).toMatchObject({ component: "rule", name: "api-validation" });
    expect(byPath["rules/api-validation.md"]?.reason).toContain("com.harnesstap/rules/");
    expect(byPath["mcp-servers/postgres-readonly.json"]?.reason).toContain("mcp.json");
  });

  it("strict import refuses the package and writes nothing", () => {
    let caught: unknown;
    try {
      importScopedMigration("plugin", personaPackage(), { strict: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportSkippedFilesError);
    const error = caught as ImportSkippedFilesError;
    expect(error.diagnostics.skipped).toHaveLength(4);
    expect(error.message).toContain("skills/colon-desc/SKILL.md");
    expect(getPluginByName("Skip repro")).toBeUndefined();
  });

  it("non-strict import reports skipped files and per-type counts, and doctor fails on them", () => {
    const result = importScopedMigration("plugin", personaPackage());
    if (result.scope !== "plugin") throw new Error("expected a plugin import");
    expect(result.skipped).toHaveLength(4);
    expect(result.resource_counts).toEqual([
      { type: "skill", discovered: 3, imported: 1 },
      { type: "rule", discovered: 1, imported: 0 },
      { type: "mcp_server", discovered: 1, imported: 0 },
      { type: "command", discovered: 1, imported: 1 },
    ]);

    const plugin = getPluginByName("Skip repro");
    expect(plugin && getPluginResources(plugin.id).length).toBe(2);

    const report = runPluginDoctor({ nameOrId: "Skip repro" });
    expect(report.valid).toBe(false);
    const skipped = report.results.filter((row) => row.check === "skipped-files");
    expect(skipped.map((row) => row.severity)).toEqual(["error", "error", "error", "error"]);
    expect(skipped.some((row) => row.message.startsWith("skills/no-frontmatter/SKILL.md:"))).toBe(true);
    expect(report.resource_counts).toEqual(result.resource_counts);
  });

  it("doctor passes a clean imported package and counts its resources", () => {
    const root = writePackage(join(ctx.projectDir, "clean"), {
      "plugin.json": JSON.stringify({ name: "clean", version: "1.0.0", description: "Clean" }),
      "skills/good-skill/SKILL.md": "---\nname: good-skill\ndescription: A valid skill.\n---\n\nBody.\n",
      "com.harnesstap/rules/style.md": "# style\n",
    });
    const result = importScopedMigration("plugin", root, { strict: true });
    if (result.scope !== "plugin") throw new Error("expected a plugin import");
    expect(result.skipped).toEqual([]);

    const report = runPluginDoctor({ nameOrId: "clean" });
    expect(report.results.filter((row) => row.check === "skipped-files")).toEqual([]);
    expect(report.resource_counts).toEqual([
      { type: "skill", discovered: 1, imported: 1 },
      { type: "rule", discovered: 1, imported: 1 },
    ]);
  });
});
