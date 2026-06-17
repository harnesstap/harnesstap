import { describe, expect, it } from "bun:test";
import packageJson from "../../package.json";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI help and command organization", () => {
  it("shows grouped command help without throwing when no subcommand is provided", async () => {
    const groupedCommands = [
      ["layer"],
      ["resource"],
      ["project"],
      ["auth"],
      ["migrate"],
      ["harness"],
      ["harness", "project"],
    ];

    for (const args of groupedCommands) {
      const result = await runCli(args);
      expect(result.exitCode).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("USAGE");
      if (args[0] === "layer") {
        expect(result.stdout).toContain("LOCAL LIBRARY");
        expect(result.stdout).toContain("REMOTE CATALOG");
      } else {
        expect(result.stdout).toContain("COMMANDS");
      }
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
    expect(result.stdout).toContain(`v${packageJson.version}`);
    expect(result.stdout).toContain("hd [options] [command]");
  });

  it("shows the CLI version in top-level help", async () => {
    const help = await runCli(["--help"]);
    const noArgs = await runCli([]);

    for (const result of [help, noArgs]) {
      expect(result.stdout).toContain(`v${packageJson.version}`);
    }
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

  it("documents resource sync --on-conflict in command help", async () => {
    const syncHelp = await runCli(["resource", "sync", "--help"]);
    expect(syncHelp.stdout).toContain("--on-conflict");
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
    // auth command group should exist in top-level help
    expect(help.stdout).toContain("auth");
    expect(help.stdout).not.toContain("\n  cloud");
    const authHelp = await runCli(["auth", "-h"]);
    expect(authHelp.stdout).toContain("login");
    expect(authHelp.stdout).toContain("status");
    expect(authHelp.stdout).toContain("orgs");
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

  it("exposes combine/uncombine commands with updated descriptions in layer help", async () => {
    const layerHelp = await runCli(["layer", "--help"]);
    
    // Should show combine and uncombine commands
    expect(layerHelp.stdout).toContain("combine");
    expect(layerHelp.stdout).toContain("uncombine");
    
    // Should describe from-project correctly
    expect(layerHelp.stdout).toContain("from-project");
    expect(layerHelp.stdout).toContain("Scan current folder and create a layer from its resources");
  });

  it("prints an expanded quick-start guide with documentation links", async () => {
    const result = await runCli(["guide"]);

    expect(result.stdout).toContain("WHAT HARNESSDECK DOES");
    expect(result.stdout).toContain("QUICK START");
    expect(result.stdout).toContain("layer search foundation");
    expect(result.stdout).toContain(
      "layer apply engineering-foundation",
    );
    expect(result.stdout).toContain("concepts");
    expect(result.stdout).toContain("DOCUMENTATION");
    expect(result.stdout).toContain("https://github.com/harnessdeck/harnessdeck#quick-start");
    expect(result.stdout).toContain(
      "https://github.com/harnessdeck/harnessdeck/blob/main/docs/cli/command-reference.md",
    );
    expect(result.stdout).toContain(
      "https://github.com/harnessdeck/harnessdeck/blob/main/docs/scenarios/scenarios.md",
    );
  });

  it("prints core concepts and command guidance", async () => {
    const result = await runCli(["concepts"]);

    expect(result.stdout).toContain("CORE CONCEPTS");
    expect(result.stdout).toContain("resource");
    expect(result.stdout).toContain("layer");
    expect(result.stdout).toContain("layer apply");
    expect(result.stdout).toContain("project mirror");
    expect(result.stdout).toContain("layer search foundation");
    expect(result.stdout).toContain("ENVIRONMENT CASCADE");
  });

  it("shows concepts in top-level help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("concepts");
    expect(result.stdout).toContain("completion");
    expect(result.stdout).toContain("scenario");
  });

  it("shows grouped layer help sections", async () => {
    const result = await runCli(["layer", "--help"]);
    expect(result.stdout).toContain("LOCAL LIBRARY");
    expect(result.stdout).toContain("REMOTE CATALOG");
    expect(result.stdout).toContain("combine");
    expect(result.stdout).toContain("pull");
  });

  it("prints scenario guide output", async () => {
    const result = await runCli(["guide", "--scenario", "11"]);
    expect(result.stdout).toContain("SCENARIO 11");
    expect(result.stdout).toContain("engineering-foundation");
  });

  it("prints concepts as json", async () => {
    const result = await runCli(["concepts", "--format", "json"]);
    const payload = JSON.parse(result.stdout);
    expect(payload.concepts).toBeArray();
    expect(payload.commands).toBeArray();
  });

  it("generates bash completion", async () => {
    const result = await runCli(["completion", "bash"]);
    expect(result.stdout).toContain("complete -F _harnessdeck_completions");
    expect(result.stdout).toContain("hd __complete bash");
    expect(result.stdout).toContain("hd harnessdeck");
  });

  it("hides __complete from top-level help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).not.toContain("__complete");
  });
});
