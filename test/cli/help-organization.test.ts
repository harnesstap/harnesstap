import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI help and command organization", () => {
  it("shows grouped command help without throwing when no subcommand is provided", async () => {
    const groupedCommands = [
      ["layer"],
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
      expect(result.stdout).toContain("--no-interactive");
      expect(result.stdout).toContain("--help");
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
    }
  });

  it("keeps removed layer subcommands as unknown commands", async () => {
    const result = runCli(["layer", "validate", "empty-layer"]);
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
    expect(result.stdout).toContain("--no-interactive");
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

  it("documents plugin update --all in command help", async () => {
    const pluginHelp = await runCli(["plugin", "update", "--help"]);
    expect(pluginHelp.stdout).toContain("--all");
    expect(pluginHelp.stdout).toContain("Update all outdated plugins");
  });

  it("disables color for non-help commands when --no-color is used", async () => {
    const context = await createTestContext("cli-help-no-color");
    const originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";

    try {
      await runCli(["init"]);
      const result = await runCli(["--no-color", "harness", "list"]);
      const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
      expect(result.stdout).not.toMatch(ansiEscapeRegex);
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
      await context.cleanup();
    }
  });

  it("shows grouped commands in help and hides legacy top-level verbs", async () => {
    const help = await runCli(["-h"]);
    const projectHelp = await runCli(["project", "-h"]);
    const layerHelp = await runCli(["layer", "-h"]);

    const harnessHelp = await runCli(["harness", "-h"]);

    expect(help.stdout).toContain("project");
    expect(help.stdout).toContain("layer");
    expect(help.stdout).toContain("resource");
    expect(help.stdout).toContain("harness");
    expect(help.stdout).not.toContain("\n  platform");
    expect(harnessHelp.stdout).toContain("status");
    expect(harnessHelp.stdout).toContain("set");
    expect(harnessHelp.stdout).toContain("list");
    expect(harnessHelp.stdout).toContain("project");
    expect(help.stdout).not.toContain("help [command]");
    expect(help.stdout).not.toContain("apply [options] <layer>");
    expect(help.stdout).not.toContain("history [options]");
    expect(help.stdout).not.toContain("revert [snapshot-id]");
    expect(help.stdout).not.toContain("export [options] <layer>");
    expect(help.stdout).not.toContain("import <file>");
    expect(help.stdout).not.toContain("\n  platforms");
    expect(help.stdout).not.toContain("status [path]");
    expect(help.stdout).not.toContain("scan [options] [path]");
    expect(projectHelp.stdout).not.toContain("help [command]");
    expect(layerHelp.stdout).not.toContain("help [command]");
    // cloud command group should exist in top-level help
    expect(help.stdout).toContain("cloud");
    const cloudHelp = await runCli(["cloud", "-h"]);
    expect(cloudHelp.stdout).toContain("login");
    expect(cloudHelp.stdout).toContain("whoami");
    expect(cloudHelp.stdout).toContain("orgs");
  });

  it("does not append [options] to subcommands in grouped help", async () => {
    const layerHelp = await runCli(["layer", "--help"]);
    
    // Should show arguments but not [options] for subcommands
    expect(layerHelp.stdout).toContain("show [name]");
    expect(layerHelp.stdout).toContain("publish <layer>");
    expect(layerHelp.stdout).toContain("export <layer>");
    
    // Should NOT contain [options] in the command name column
    expect(layerHelp.stdout).not.toContain("show [options]");
    expect(layerHelp.stdout).not.toContain("publish [options]");
    expect(layerHelp.stdout).not.toContain("export [options]");
  });

  it("exposes attach/detach commands with updated descriptions in layer help", async () => {
    const layerHelp = await runCli(["layer", "--help"]);
    
    // Should show attach and detach commands
    expect(layerHelp.stdout).toContain("attach");
    expect(layerHelp.stdout).toContain("detach");
    
    // Should describe from-project correctly
    expect(layerHelp.stdout).toContain("from-project");
    expect(layerHelp.stdout).toContain("Scan current folder and create a layer from its resources");
  });
});
