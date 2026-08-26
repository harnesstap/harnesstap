import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, test } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("CLI init", () => {
  test("initializes the database and seeds default profile plugin", async () => {
    const context = await createTestContext("cli-init");

    try {
      const result = await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      expect(result.stdout).toContain("HarnessTap initialized");
      expect(result.stdout).toContain("Database");
      expect(result.stdout).toContain("NEXT STEPS");
      expect(result.stdout).not.toContain("already exists");
      expect(result.stdout).toContain("plugin list --search foundation");
      expect(result.stdout).toContain('profile use "global default"');
      expect(result.stdout).toContain("apply engineering-foundation");
      expect(existsSync(context.connection.getDbPath())).toBe(true);
      expect(context.connection.getDbPath()).toContain(".harnesstap/harnesstap.db");
      expect(pluginModel.listPlugins()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "global default",
            tags: expect.arrayContaining(["profile"]),
          }),
        ]),
      );
      const activeProfile = JSON.parse(
        readFileSync(
          `${context.homeDir}/.harnesstap/active-profile.json`,
          "utf-8",
        ),
      ) as { name: string };
      expect(activeProfile.name).toBe("global default");
      const environmentModel = await import("../../src/models/environment.ts");
      expect(environmentModel.listEnvironments()).toEqual([
        expect.objectContaining({ name: "default" }),
      ]);
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

      expect(result.stdout).toContain("HarnessTap initialized");
      expect(result.stdout).toContain("TRACKED DIRECTORIES");
      expect(result.stdout).toMatch(/\|\s+PATH\s+\|/);
      expect(result.stdout).toContain("~");
      expect(result.stdout).toContain("home");
      expect(result.stdout).toMatch(/tracked director/);
      expect(result.stdout).not.toContain("HOME DEFAULTS");
      expect(result.stdout).not.toContain("Built-in Plugins");
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

      const pluginShow = await runCli(["plugin", "show", "global default"]);
      expect(pluginShow.stdout).toContain("instruction");
      expect(pluginShow.stdout).not.toContain("No resources in this plugin.");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const defaultPlugin = pluginModel.listPlugins().find(
        (plugin) => plugin.name === "global default",
      );
      expect(defaultPlugin).toBeDefined();
      const db = context.connection.getDb();
      db.prepare("DELETE FROM plugin_resources WHERE plugin_id = ?").run(
        defaultPlugin?.id,
      );

      const rerun = await runCli(["init"]);

      expect(rerun.stdout).toContain("TRACKED DIRECTORIES");
      expect(rerun.stdout).toContain("~");
      expect(homeResources()).toHaveLength(2);

      const backfilledShow = await runCli(["plugin", "show", "global default"]);
      expect(backfilledShow.stdout).toContain("instruction");
      expect(backfilledShow.stdout).not.toContain("No resources in this plugin.");
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

      expect(result.stdout).toContain("HarnessTap initialized");
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

  it("warns when init reruns with saved harness defaults", async () => {
    const context = await createTestContext("cli-init-rerun-warning");

    try {
      await runCli([
        "init",
        "--main",
        "claude-code",
        "--aliases",
        "cursor",
      ]);

      const rerun = await runCli([
        "init",
        "--main",
        "cursor",
        "--aliases",
        "codex",
      ]);

      expect(rerun.stdout).toContain("HarnessTap initialized");
      expect(rerun.stdout).toContain("main: claude-code");
      expect(rerun.stdout).toContain("aliases: cursor");
      expect(rerun.stdout).toContain("will be overwritten");
      expect(rerun.stdout).not.toContain("Built-in Plugins");
      expect(rerun.stdout).not.toContain("already up to date");
    } finally {
      await context.cleanup();
    }
  });

  it("does not warn about harness defaults when init reruns without harness selection input", async () => {
    const context = await createTestContext("cli-init-rerun-no-harness-change");

    try {
      await runCli([
        "init",
        "--main",
        "claude-code",
        "--aliases",
        "cursor",
      ]);

      const rerun = await runCli(["init"]);

      expect(rerun.stdout).toContain("HarnessTap initialized");
      expect(rerun.stdout).toContain("already exists");
      expect(rerun.stdout).not.toContain("will be overwritten");
      expect(rerun.stdout).not.toContain("Existing harness defaults");
    } finally {
      await context.cleanup();
    }
  });

  it("recovers from a malformed cloud account store during init", async () => {
    const context = await createTestContext("cli-init-malformed-cloud-store");

    try {
      writeTextFile(
        `${context.homeDir}/.harnesstap/cloud-accounts.json`,
        "{not-valid-json",
      );

      const result = await runCli(["init"]);
      expect(result.stdout).toContain("HarnessTap initialized");
      expect(existsSync(context.connection.getDbPath())).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
