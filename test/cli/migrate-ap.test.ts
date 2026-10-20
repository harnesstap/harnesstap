import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("migrate-ap-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seed(): void {
  const plugin = createPlugin({ name: "my-plugin", version: "1.2.0" });
  addResourceToPlugin(
    plugin.id,
    createResource({
      type: "skill",
      name: "deploy",
      description: "d",
      content: "# D",
      metadata: {},
      source: "test",
    }).id,
  );
}

describe("migrate export --plugin", () => {
  it("prints a home path with a tilde", async () => {
    seed();
    const out = join(ctx.homeDir, "pkg");
    const result = await runCli(["migrate", "export", "--plugin", "my-plugin", "-o", out]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("~/pkg");
    expect(result.stdout).not.toContain(ctx.homeDir);
  });

  it("writes a package directory by default", async () => {
    seed();
    const out = join(ctx.projectDir, "pkg");
    const result = await runCli(["migrate", "export", "--plugin", "my-plugin", "-o", out]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(existsSync(join(out, "plugin.json"))).toBe(true);
    expect(existsSync(join(out, "skills", "deploy", "SKILL.md"))).toBe(true);
  });

  it("writes a single-file envelope with --single-file", async () => {
    seed();
    const out = join(ctx.projectDir, "my-plugin.ap.json");
    const result = await runCli([
      "migrate",
      "export",
      "--plugin",
      "my-plugin",
      "--single-file",
      "-o",
      out,
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    const document = JSON.parse(readFileSync(out, "utf8")) as { schema: string };
    expect(document.schema).toBe("urn:harnesstap:ap-package:v1");
  });

  it("emits JSON describing the written package", async () => {
    seed();
    const out = join(ctx.projectDir, "pkg");
    const result = await runCli([
      "migrate",
      "export",
      "--plugin",
      "my-plugin",
      "-o",
      out,
      "--format",
      "json",
    ]);
    const payload = JSON.parse(result.stdout) as {
      scope: string;
      output: string;
      files: string[];
    };
    expect(payload.scope).toBe("plugin");
    expect(payload.files).toContain("plugin.json");
  });

  it("never writes a .harnesstap.toml", async () => {
    seed();
    const out = join(ctx.projectDir, "pkg");
    await runCli(["migrate", "export", "--plugin", "my-plugin", "-o", out]);
    expect(existsSync(join(ctx.projectDir, "my-plugin.harnesstap.toml"))).toBe(false);
  });
});

describe("migrate export --resource", () => {
  it("wraps a single resource in a one-resource package", async () => {
    createResource({
      type: "rule",
      name: "style",
      description: "Style rule",
      content: "Use tabs.",
      metadata: { globs: [], always_apply: true },
      source: "test",
    });
    const out = join(ctx.projectDir, "rule-pkg");
    const result = await runCli(["migrate", "export", "--resource", "rule:style", "-o", out]);
    expect(result.exitCode ?? 0).toBe(0);
    const manifest = JSON.parse(readFileSync(join(out, "plugin.json"), "utf8")) as {
      name: string;
    };
    expect(manifest.name).toBe("style");
    expect(existsSync(join(out, "com.harnesstap", "rules", "style.md"))).toBe(true);
  });
});

describe("migrate export --environment", () => {
  it("is no longer a supported scope", async () => {
    const result = await runCli([
      "migrate",
      "export",
      "--environment",
      "work",
      "-o",
      join(ctx.projectDir, "x"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--workspace");
  });
});

function writeSkippingPackage(root: string): string {
  mkdirSync(join(root, "skills", "no-frontmatter"), { recursive: true });
  mkdirSync(join(root, "rules"), { recursive: true });
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "skippy", version: "1.0.0", description: "Skips files" }),
  );
  writeFileSync(join(root, "skills", "no-frontmatter", "SKILL.md"), "# no frontmatter\n");
  writeFileSync(join(root, "rules", "style.md"), "# style\n");
  return root;
}

describe("migrate import skipped files", () => {
  it("refuses a package with skipped files when not interactive", async () => {
    const pkg = writeSkippingPackage(join(ctx.projectDir, "skippy"));
    const result = await runCli(["migrate", "import", pkg, "--plugin"]);
    expect(result.exitCode).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("skills/no-frontmatter/SKILL.md: SKILL.md has no YAML frontmatter");
    expect(output).toContain("rules/style.md: root rules/");
    expect(output).toContain("Not imported: 2 files would be skipped.");
    expect(getPluginByName("skippy")).toBeUndefined();
  });

  it("imports the rest with --no-strict and prints per-type counts", async () => {
    const pkg = writeSkippingPackage(join(ctx.projectDir, "skippy"));
    const result = await runCli(["migrate", "import", pkg, "--plugin", "--no-strict"]);
    expect(result.exitCode ?? 0).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("skipped skills/no-frontmatter/SKILL.md");
    expect(output).toContain("imported of discovered: skill 0 of 1, rule 0 of 1");
    expect(getPluginByName("skippy")).toBeDefined();

    const doctor = await runCli(["plugin", "doctor", "skippy", "--format", "json"]);
    expect(doctor.exitCode).toBe(1);
    const report = JSON.parse(doctor.stdout) as { valid: boolean; results: Array<{ check: string }> };
    expect(report.valid).toBe(false);
    expect(report.results.filter((row) => row.check === "skipped-files")).toHaveLength(2);
  });
});

describe("migrate import", () => {
  it("imports a package directory", async () => {
    seed();
    const out = join(ctx.projectDir, "pkg");
    await runCli(["migrate", "export", "--plugin", "my-plugin", "-o", out]);

    const fresh = await createInitializedTestContext("migrate-ap-2-");
    try {
      const result = await runCli(["migrate", "import", out]);
      expect(result.exitCode ?? 0).toBe(0);
      const imported = getPluginByName("my-plugin");
      expect(imported).toBeDefined();
      expect(getPluginResources(imported!.id).map((r) => r.name)).toContain("deploy");
    } finally {
      await fresh.cleanup();
    }
  });

  it("imports a single-file envelope", async () => {
    seed();
    const out = join(ctx.projectDir, "my-plugin.ap.json");
    await runCli(["migrate", "export", "--plugin", "my-plugin", "--single-file", "-o", out]);

    const fresh = await createInitializedTestContext("migrate-ap-3-");
    try {
      const result = await runCli(["migrate", "import", out]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(getPluginByName("my-plugin")).toBeDefined();
    } finally {
      await fresh.cleanup();
    }
  });

  it("rejects a .harnesstap.toml with a message naming the package form", async () => {
    const legacy = join(ctx.projectDir, "old.harnesstap.toml");
    writeFileSync(legacy, 'schema = "urn:harnesstap:layer:v1"\nversion = 1\n');
    const result = await runCli(["migrate", "import", legacy]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Agent Plugins package/);
    expect(result.stderr).toContain(".ap.json");
  });
});
