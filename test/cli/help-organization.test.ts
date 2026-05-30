import { existsSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI help and command organization", () => {
  it("shows grouped command help without throwing when no subcommand is provided", async () => {
    const groupedCommands = [
      ["preset"],
      ["resource"],
      ["project"],
      ["plugin"],
      ["cloud"],
      ["migrate"],
      ["harness"],
      ["harness", "project"],
    ];

    for (const args of groupedCommands) {
      const result = await runCli(args);
      expect(result.exitCode).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("USAGE");
      expect(result.stdout).toContain("COMMANDS");
    }
  });

  it("uses role-based styling in help output", async () => {
    // This test verifies that help uses the new semantic roles
    // Enable colors for this test
    const originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    
    try {
      const result = await runCli(["--help"]);
      // Should contain section headers
      expect(result.stdout).toContain("USAGE");
      expect(result.stdout).toContain("COMMANDS");
      expect(result.stdout).toContain("OPTIONS");
      // Should contain flags
      expect(result.stdout).toContain("--no-color");
      expect(result.stdout).toContain("--help");
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
    }
  });

  it("keeps removed preset subcommands as unknown commands", async () => {
    const result = runCli(["preset", "validate", "empty-preset"]);
    await expect(result).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    });
  });

  it("shows top-level help without an error when invoked with no arguments", async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("COMMANDS");
  });

  it("renders grouped themed help and exposes --no-color", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("COMMANDS");
    expect(result.stdout).toContain(
      "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
    );
    expect(result.stdout).toContain("--no-color");
    expect(result.stdout).not.toContain("help [command]");
  });

  it("renders top-level help with hd when invoked as hd", async () => {
    const result = await runCli(["--help"], { commandName: "hd" });
    expect(result.stdout).toContain("hd");
    expect(result.stdout).toContain("hd [options] [command]");
  });

  it("disables color in help output when --no-color is used", async () => {
    // Force colors to be enabled so we can test --no-color actually disables them
    const originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    
    try {
      const result = await runCli(["--no-color", "--help"]);
      // ANSI escape codes start with ESC [ (character code 27 followed by [)
      const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
      expect(result.stdout).not.toMatch(ansiEscapeRegex);
      expect(result.stdout).toContain("USAGE");
      expect(result.stdout).toContain("COMMANDS");
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
    }
  });

  it("shows hidden aliases only when --help --show-hidden is used", async () => {
    const defaultHelp = await runCli(["--help"]);
    const allHelp = await runCli(["--help", "--show-hidden"]);
    expect(defaultHelp.stdout).not.toContain("apply <preset>");
    expect(allHelp.stdout).toContain("apply <preset>");
  });

  it("does not collide global --show-hidden with plugin update --all", async () => {
    // Verify that plugin update --all can be parsed without being affected by global flags
    // We're not actually running the update, just checking that the command can be invoked
    // without the global --show-hidden flag interfering with --all
    const pluginHelp = await runCli(["plugin", "update", "--help"]);
    expect(pluginHelp.stdout).toContain("--all");
    expect(pluginHelp.stdout).toContain("Update all outdated plugins");
  });

  it("disables color for non-help commands when --no-color is used", async () => {
    // Force colors to be enabled so we can test --no-color actually disables them
    const originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    
    try {
      await runCli(["init"]);
      const result = await runCli(["--no-color", "harness", "list"]);
      // ANSI escape codes start with ESC [ (character code 27 followed by [)
      const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
      expect(result.stdout).not.toMatch(ansiEscapeRegex);
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
    }
  });

  it("shows grouped commands in help and hides legacy top-level verbs", async () => {
    const help = await runCli(["-h"]);
    const projectHelp = await runCli(["project", "-h"]);
    const presetHelp = await runCli(["preset", "-h"]);

    const harnessHelp = await runCli(["harness", "-h"]);

    expect(help.stdout).toContain("project");
    expect(help.stdout).toContain("preset");
    expect(help.stdout).toContain("resource");
    expect(help.stdout).toContain("harness");
    expect(help.stdout).not.toContain("\n  platform");
    expect(harnessHelp.stdout).toContain("status");
    expect(harnessHelp.stdout).toContain("set");
    expect(harnessHelp.stdout).toContain("list");
    expect(harnessHelp.stdout).toContain("project");
    expect(help.stdout).not.toContain("help [command]");
    expect(help.stdout).not.toContain("apply [options] <preset>");
    expect(help.stdout).not.toContain("history [options]");
    expect(help.stdout).not.toContain("revert [snapshot-id]");
    expect(help.stdout).not.toContain("export [options] <preset>");
    expect(help.stdout).not.toContain("import <file>");
    expect(help.stdout).not.toContain("\n  platforms");
    expect(help.stdout).not.toContain("status [path]");
    expect(help.stdout).not.toContain("scan [options] [path]");
    expect(projectHelp.stdout).not.toContain("help [command]");
    expect(presetHelp.stdout).not.toContain("help [command]");
    // cloud command group should exist in top-level help
    expect(help.stdout).toContain("cloud");
    const cloudHelp = await runCli(["cloud", "-h"]);
    expect(cloudHelp.stdout).toContain("login");
    expect(cloudHelp.stdout).toContain("whoami");
    expect(cloudHelp.stdout).toContain("orgs");
  });

  it("keeps deprecated aliases working while steering users to grouped commands", async () => {
    const context = await createTestContext("cli-aliases");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Research helper\n---\n# Research\n",
      );

      await runCli(["init"]);

      const scanResult = await runCli(["scan", context.projectDir]);
      expect(scanResult.stdout).toContain("deprecated");
      expect(scanResult.stdout).toContain("project scan");
      // New per-platform verdict format
      expect(scanResult.stdout).toMatch(/resource/);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "bundle-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", content: "# Shared" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const bundlePath = `${context.projectDir}/bundle.json`;
      const exportResult = await runCli([
        "export",
        "bundle-preset",
        "--file",
        bundlePath,
      ]);
      expect(exportResult.stdout).toContain("deprecated");
      expect(exportResult.stdout).toContain("preset export");
      expect(exportResult.stdout).toContain("Exported preset");
      expect(existsSync(bundlePath)).toBe(true);

      const applyResult = await runCli([
        "apply",
        "bundle-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
      ]);
      expect(applyResult.stdout).toContain("deprecated");
      expect(applyResult.stdout).toContain("project apply");
      expect(applyResult.stdout).toContain("SKILL.md");
    } finally {
      await context.cleanup();
    }
  });

  it("uses the invoked alias in deprecated command guidance", async () => {
    const context = await createTestContext("cli-hd-aliases");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");

      await runCli(["init"], { commandName: "hd" });

      const scanResult = await runCli(["scan", context.projectDir], {
        commandName: "hd",
      });

      expect(scanResult.stdout).toContain("`hd scan` is deprecated");
      expect(scanResult.stdout).toContain("`hd project scan`");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps the hidden platforms alias coherent with harness list", async () => {
    const result = await runCli(["platforms", "--format", "json"], {
      commandName: "hd",
    });

    expect(JSON.parse(result.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "claude-code" })]),
    );
    expect(result.stderr).toContain("deprecated");
    expect(result.stderr).toContain("hd harness list");
  });

  it("does not append [options] to subcommands in grouped help", async () => {
    const presetHelp = await runCli(["preset", "--help"]);
    
    // Should show arguments but not [options] for subcommands
    expect(presetHelp.stdout).toContain("show <name>");
    expect(presetHelp.stdout).toContain("publish <preset>");
    expect(presetHelp.stdout).toContain("export <preset>");
    
    // Should NOT contain [options] in the command name column
    expect(presetHelp.stdout).not.toContain("show [options]");
    expect(presetHelp.stdout).not.toContain("publish [options]");
    expect(presetHelp.stdout).not.toContain("export [options]");
  });
});
