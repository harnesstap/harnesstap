import { existsSync } from "node:fs";
import { describe, expect, it, test } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("CLI init", () => {
  test("initializes the database and seeds built-in presets", async () => {
    const context = await createTestContext("cli-init");

    try {
      const result = await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      expect(result.stdout).toContain("Harnessdeck initialized");
      expect(result.stdout).toContain("Database");
      expect(existsSync(context.connection.getDbPath())).toBe(true);
      expect(context.connection.getDbPath()).toContain(".harnessdeck/harnessdeck.db");
      expect(
        presetModel.listPresets({ templates_only: true }).length,
      ).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("imports resources from default home folders and reports discoveries", async () => {
    const context = await createTestContext("cli-init-home-defaults");

    try {
      writeTextFile(
        `${context.homeDir}/.claude/CLAUDE.md`,
        "# Home Claude instructions",
      );
      writeTextFile(
        `${context.homeDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Home research helper\n---\n# Research\n",
      );

      const result = await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const homeResources = () =>
        resourceModel
          .listResources()
          .filter((resource) => resource.source.startsWith("~/.claude"));

      expect(result.stdout).toContain("Harnessdeck initialized");
      expect(result.stdout).toContain("Built-in Presets");
      expect(result.stdout).toContain("HOME DEFAULTS");
      expect(result.stdout).toContain("Claude Code");
      expect(result.stdout).toContain("~/.claude");
      expect(result.stdout).toContain("Contains");
      expect(result.stdout).toContain("CLAUDE.md, skills/");
      expect(result.stdout).toContain("Found");
      expect(result.stdout).toContain("2 resources");
      expect(result.stdout).toContain("1 instruction, 1 skill");
      expect(result.stdout).toContain("Built-in Presets");
      expect(result.stdout).toContain("seeded");
      expect(result.stdout).toContain("Status");
      expect(result.stdout).toContain("2 new resources imported");
      expect(result.stdout).not.toContain("claude-instructions");
      expect(result.stdout).not.toContain("skill          research");
      expect(homeResources()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "instruction",
            source: "~/.claude/CLAUDE.md",
          }),
          expect.objectContaining({
            type: "skill",
            source: "~/.claude/skills/research/SKILL.md",
          }),
        ]),
      );

      const rerun = await runCli(["init"]);

      expect(rerun.stdout).toContain("1 instruction, 1 skill");
      expect(rerun.stdout).toContain("already tracked");
      expect(homeResources()).toHaveLength(2);
    } finally {
      await context.cleanup();
    }
  });

  it("accepts harness selection flags during init and persists the preference", async () => {
    const context = await createTestContext("cli-init-harness-selection");

    try {
      const result = await runCli([
        "init",
        "--main",
        "claude-code",
        "--aliases",
        "cursor,codex",
      ]);
      const show = await runCli(["harness", "status", "--format", "json"]);

      expect(result.stdout).toContain("Harnessdeck initialized");
      expect(JSON.parse(show.stdout)).toEqual(
        expect.objectContaining({
          main_harness: "claude-code",
          alias_harnesses: ["cursor", "codex"],
        }),
      );
    } finally {
      await context.cleanup();
    }
  });
});
