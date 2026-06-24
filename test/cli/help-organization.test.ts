import { describe, expect, it } from "bun:test";
import packageJson from "../../package.json";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI help and command organization", () => {
  it("scan -h shows help instead of requiring --harness value", async () => {
    const result = await runCli(["scan", "-h"]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toBe("");
  });

  it("layer from-project -h shows help instead of requiring --harness value", async () => {
    const result = await runCli(["layer", "from-project", "-h"]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toBe("");
  });

  it("shows grouped command help without throwing when no subcommand is provided", async () => {
    const groupedCommands = [
      ["layer"],
      ["resource"],
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
      expect(result.stdout).toContain("COMMAND GROUPS");
      expect(result.stdout).toContain("PROJECT");
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
    for (const args of [
      ["layer", "validate", "empty-layer"],
      ["layer", "export", "empty-layer"],
      ["layer", "import", "./missing.harnessdeck.toml"],
    ]) {
      await expect(runCli(args)).rejects.toMatchObject({
        code: "commander.unknownCommand",
        exitCode: 1,
        message: expect.stringMatching(/unknown command/i),
      });
    }
  });

  it("shows top-level help without an error when invoked with no arguments", async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("COMMAND GROUPS");
    expect(result.stdout).toContain("PROJECT");
  });

  it("renders grouped themed help and exposes --no-color", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("COMMAND GROUPS");
    expect(result.stdout).toContain("PROJECT");
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
      expect(result.stdout).toContain("COMMAND GROUPS");
      expect(result.stdout).toContain("PROJECT");
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

  it("shows project-local verbs in top-level help", async () => {
    const help = await runCli(["-h"]);
    const layerHelp = await runCli(["layer", "-h"]);
    const harnessHelp = await runCli(["harness", "-h"]);

    expect(help.stdout).toContain("COMMAND GROUPS");
    expect(help.stdout).toContain("PROJECT");
    expect(help.stdout).toContain("layer");
    expect(help.stdout).toContain("scan");
    expect(help.stdout).toContain("mirror");
    expect(help.stdout).toContain("status");
    expect(help.stdout).toContain("history");
    expect(help.stdout).toContain("revert");
    expect(help.stdout).toContain("resource");
    expect(help.stdout).toContain("harness");
    expect(help.stdout).not.toContain("\n  platform");
    expect(harnessHelp.stdout).toContain("status");
    expect(harnessHelp.stdout).toContain("set");
    expect(harnessHelp.stdout).toContain("list");
    expect(harnessHelp.stdout).toContain("project");
    expect(help.stdout).not.toContain("help [command]");
    expect(help.stdout).not.toContain("apply [options] <layer>");
    expect(help.stdout).not.toContain("export [options] <layer>");
    expect(help.stdout).not.toContain("import <file>");
    expect(help.stdout).not.toContain("\n  platforms");
    expect(help.stdout).not.toContain("\n  project ");
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
    
    // Should NOT contain [options] in the command name column
    expect(layerHelp.stdout).not.toContain("show [options]");
    expect(layerHelp.stdout).not.toContain("publish [options]");
    expect(layerHelp.stdout).not.toContain("export [options]");
  });

  it("exposes layer edit with scripting flags in layer help", async () => {
    const layerHelp = await runCli(["layer", "--help"]);
    
    expect(layerHelp.stdout).toContain("edit");
    expect(layerHelp.stdout).toContain("scripting");
    
    expect(layerHelp.stdout).toContain("from-project");
    expect(layerHelp.stdout).toContain("Scan current folder and create a layer from its resources");
  });

  it("prints help with concepts and scenario index", async () => {
    const result = await runCli(["help"]);

    expect(result.stdout).toContain("CORE CONCEPTS");
    expect(result.stdout).toContain("SCENARIOS");
    expect(result.stdout).toContain("resource");
    expect(result.stdout).toContain("layer");
    expect(result.stdout).toContain("layer apply");
    expect(result.stdout).toContain("mirror .");
    expect(result.stdout).toContain("layer search foundation");
    expect(result.stdout).toContain("ENVIRONMENT CASCADE");
    expect(result.stdout).toContain("hd help scenario");
    expect(result.stdout).toMatch(/11\s+Start from a catalog baseline/);
  });

  it("shows help in top-level help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("help");
    expect(result.stdout).toContain("completion");
    expect(result.stdout).not.toMatch(/\n {2}concepts/);
    expect(result.stdout).not.toMatch(/\n {2}guide/);
    expect(result.stdout).not.toMatch(/\n {2}scenario /);
  });

  it("shows grouped layer help sections", async () => {
    const result = await runCli(["layer", "--help"]);
    expect(result.stdout).toContain("LOCAL LIBRARY");
    expect(result.stdout).toContain("REMOTE CATALOG");
    expect(result.stdout).toContain("edit");
    expect(result.stdout).toContain("pull");
  });

  it("prints scenario guide output", async () => {
    const result = await runCli(["help", "scenario", "11"]);
    expect(result.stdout).toContain("SCENARIO 11");
    expect(result.stdout).toContain("engineering-foundation");
  });

  it("prints help as json", async () => {
    const result = await runCli(["help", "--format", "json"]);
    const payload = JSON.parse(result.stdout);
    expect(payload.concepts.concepts).toBeArray();
    expect(payload.concepts.commands).toBeArray();
    expect(payload.scenarios).toBeArray();
    expect(payload.scenarios.some((scenario: { id: number }) => scenario.id === 11)).toBe(
      true,
    );
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

  it("documents every environment subcommand in group help", async () => {
    const result = await runCli(["environment", "-h"]);
    for (const sub of ["create", "edit", "list", "show", "delete", "use", "status"]) {
      expect(result.stdout).toContain(sub);
    }
    expect(result.stdout).toMatch(/create <name>.*Create/);
    expect(result.stdout).toMatch(/use <name>.*Set/);
  });

  it("documents profile list and use in group help", async () => {
    const result = await runCli(["profile", "-h"]);
    expect(result.stdout).toMatch(/list \(ls\).*List local profile/);
    expect(result.stdout).toMatch(/use \[name\].*Switch the active profile/);
  });
});
