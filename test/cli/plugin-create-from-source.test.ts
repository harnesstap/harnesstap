import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("CLI plugin create --from", () => {
  it("creates a configured plugin without installing skills to hub", async () => {
    const context = await createTestContext("cli-plugin-create-from");
    try {
      await runCli(["init", "--main", "codex"]);
      const result = await runCli([
        "plugin",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "caveman,tdd",
        "--yes",
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.plugin).toBe("dbt-expert");
      expect(payload.attached.sort()).toEqual(["caveman", "tdd"]);
      expect(payload.installed).toEqual([]);
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("fails when the plugin already exists without --on-conflict", async () => {
    const context = await createTestContext("cli-plugin-create-from-conflict");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "dbt-expert"]);
      const result = await runCli([
        "plugin",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "caveman",
        "--yes",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/Plugin already exists/);
    } finally {
      await context.cleanup();
    }
  });

  it("merges skill refs with --on-conflict merge", async () => {
    const context = await createTestContext("cli-plugin-create-from-merge");
    try {
      await runCli(["init"]);
      await runCli([
        "plugin",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "caveman",
        "--yes",
      ]);
      const result = await runCli([
        "plugin",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "tdd",
        "--on-conflict",
        "merge",
        "--yes",
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.conflict_policy).toBe("merge");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.getPlugin("dbt-expert");
      if (!plugin) throw new Error("Expected dbt-expert plugin");
      const attached = pluginModel.getPluginResources(plugin.id);
      expect(
        attached
          .filter((resource) => resource.type === "skill")
          .map((resource) => resource.name)
          .sort(),
      ).toEqual(["caveman", "tdd"]);
    } finally {
      await context.cleanup();
    }
  });
});
