import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const commandsRoot = resolve(repoRoot, "src/cli/commands");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function runPackedCli(homeDir: string, args: string[], cwd?: string) {
  return spawnSync(process.execPath, [resolve(repoRoot, "src/bin.ts"), ...args], {
    cwd: cwd ?? homeDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      HARNESSTAP_TELEMETRY: "0",
      HARNESSTAP_UPDATE_CHECK: "0",
    },
  });
}

describe("G6 CLI error contract", () => {
  it("bans ui.danger in src/cli/commands", () => {
    const hits: string[] = [];
    for (const file of walk(commandsRoot)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.includes("ui.danger(")) {
          hits.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("exits non-zero without USAGE for P1-11, P1-16 and commander errors", async () => {
    const context = await createTestContext("cli-g6-exit-codes");
    try {
      await runCli(["init", "--no-interactive"]);
      await runCli(["plugin", "create", "demo-plugin"]);
      await runCli(["environment", "create", "dev", "--blank", "--yes"]);

      const cases: Array<{ args: string[]; stdoutNeedle?: string; stderrNeedle: string }> = [
        { args: ["resource", "list", "--type", "bogus"], stderrNeedle: "isn't a resource type" },
        { args: ["resource", "list", "bogus"], stderrNeedle: "isn't a resource type" },
        { args: ["resource", "show", "nope"], stderrNeedle: 'No resource named "nope"' },
        { args: ["resource", "delete", "nope"], stderrNeedle: 'No resource named "nope"' },
        { args: ["plugin", "show", "nope"], stderrNeedle: 'No plugin named "nope"' },
        { args: ["status", "/nonexistent-g6-status"], stderrNeedle: "Directory not found" },
        { args: ["scan", "/nonexistent-g6-scan"], stderrNeedle: "Directory not found" },
        { args: ["targets", "--project", "/nonexistent-g6-targets"], stderrNeedle: "Directory not found" },
        { args: ["auth", "orgs"], stderrNeedle: "Not authenticated" },
        {
          args: ["plugin", "create", "demo-plugin"],
          stderrNeedle: 'A plugin named "demo-plugin" already exists',
        },
        {
          args: ["environment", "create", "dev", "--blank", "--yes"],
          stderrNeedle: 'An environment named "dev" already exists',
        },
        {
          args: ["migrate", "import", "/nonexistent.ap.json"],
          stderrNeedle: "File not found",
        },
        {
          args: ["harness", "set", "--harnesses", "bogus"],
          stderrNeedle: "Unsupported harness",
        },
      ];

      for (const testCase of cases) {
        const result = runPackedCli(context.homeDir, testCase.args, context.projectDir);
        expect(result.status, testCase.args.join(" ")).not.toBe(0);
        expect(result.stderr, testCase.args.join(" ")).toContain("Error:");
        expect(result.stderr, testCase.args.join(" ")).toContain(testCase.stderrNeedle);
        expect(result.stderr, testCase.args.join(" ")).not.toContain("USAGE");
        expect(result.stderr, testCase.args.join(" ")).not.toMatch(/UNIQUE constraint failed/i);
      }
    } finally {
      await context.cleanup();
    }
  });

  it("maps raw git clone failures for ht add --list", async () => {
    const context = await createTestContext("cli-g6-git");
    try {
      await runCli(["init", "--no-interactive"]);
      const result = runPackedCli(
        context.homeDir,
        ["add", "does-not-exist-xyz/nope", "--list"],
        context.projectDir,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("Couldn't reach");
      expect(result.stderr).not.toContain("could not read Username");
      expect(result.stderr).not.toContain("USAGE");
      expect(result.stderr).not.toContain("fatal:");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --on-conflict abort with the invalid-value error", async () => {
    const context = await createTestContext("cli-g6-abort-rejected");
    try {
      await runCli(["init", "--no-interactive"]);
      const result = runPackedCli(context.homeDir, ["resource", "sync", "--on-conflict", "abort"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("Invalid --on-conflict value: abort.");
      expect(result.stderr).toContain("Use replace, skip, prompt or cancel.");
    } finally {
      await context.cleanup();
    }
  });

  it("quotes names in duplicate-create copy and accepts --on-conflict replace", async () => {
    const context = await createTestContext("cli-g6-replace-alias");
    try {
      await runCli(["init", "--no-interactive"]);
      await runCli(["plugin", "create", "demo-plugin"]);
      const replaced = await runCli([
        "plugin",
        "create",
        "demo-plugin",
        "--on-conflict",
        "replace",
      ]);
      expect(replaced.exitCode ?? 0).toBe(0);
      expect(replaced.stdout).toContain("demo-plugin");
    } finally {
      await context.cleanup();
    }
  });
});

describe("formatHintCommand", () => {
  it("always uses ht and quotes resource scope args", async () => {
    const { formatHintCommand, formatCommand } = await import("../../src/cli/shared.ts");
    expect(
      formatHintCommand(["resource", "scope", "filesystem", "--add", "claude-code,cursor"]),
    ).toBe("ht resource scope filesystem --add claude-code,cursor");
    expect(formatCommand("resource scope filesystem --add claude-code,cursor")).toBe(
      "ht resource scope filesystem --add claude-code,cursor",
    );
    expect(formatCommand("ht resource scope filesystem --add claude-code,cursor")).toBe(
      "ht resource scope filesystem --add claude-code,cursor",
    );
    expect(formatHintCommand(["profile", "use", "global default"])).toBe(
      'ht profile use "global default"',
    );
    expect(formatCommand(["apply", "/tmp/my pack.tgz"])).toBe(
      'ht apply "/tmp/my pack.tgz"',
    );
    expect(formatCommand(["mcp", "search", "github copilot", "--cursor", "abc"])).toBe(
      'ht mcp search "github copilot" --cursor abc',
    );
  });
});

describe("DS-6 central copy", () => {
  it("matches designer error, hint, and conflict vocabulary", async () => {
    const { CLI_ERRORS, CLI_HINTS, ON_CONFLICT_HELP, ON_CONFLICT_VALUE_HELP, SCOPE_COPY } =
      await import("../../src/cli/messages.ts");
    expect(CLI_ERRORS.pluginAlreadyExists("demo-plugin")).toBe(
      'A plugin named "demo-plugin" already exists.',
    );
    expect(CLI_HINTS.onConflictReplace).toBe("Use --on-conflict replace to replace it.");
    expect(CLI_ERRORS.missingProfileName).toBe("Pass a profile name.");
    expect(CLI_HINTS.profileUseExample).toBe('For example: ht profile use "global default"');
    expect(CLI_ERRORS.noProfileNamed("work")).toBe('No profile named "work".');
    expect(CLI_ERRORS.mcpNotInLibrary("github")).toBe('"github" isn\'t in your library.');
    expect(CLI_HINTS.mcpSearch("github")).toBe("Run ht mcp search github to find it.");
    expect(CLI_ERRORS.newerSchema).toBe("This data was saved by a newer HarnessTap.");
    expect(CLI_HINTS.updateNpm).toBe("Update with: npm i -g harnesstap");
    expect(CLI_HINTS.unsavedChanges).toBe("Run again with --changes save, stash or discard.");
    expect(CLI_HINTS.scopeAdd("filesystem", "cursor,codex")).toBe(
      "Run ht resource scope filesystem --add cursor,codex.",
    );
    expect(CLI_HINTS.portableMcpTip(
      "filesystem",
      "Cursor and Codex",
      "ht resource scope filesystem --add cursor,codex",
    )).toBe(
      'Tip: "filesystem" also works on Cursor and Codex. Run ht resource scope filesystem --add cursor,codex.',
    );
    expect(ON_CONFLICT_HELP).toBe(
      "What to do when it already exists: replace, skip, prompt or cancel",
    );
    expect(ON_CONFLICT_VALUE_HELP.replace).toBe("Replace the existing one");
    expect(ON_CONFLICT_VALUE_HELP.skip).toBe("Keep the existing one and move on");
    expect(ON_CONFLICT_VALUE_HELP.prompt).toBe("Ask each time");
    expect(ON_CONFLICT_VALUE_HELP.cancel).toBe("Stop without changing anything");
    expect(SCOPE_COPY.mainHarnessTooltip).toBe(
      "Your main harness. It wins when harnesses disagree.",
    );
  });
});

describe("parseOnConflict", () => {
  it("rejects abort instead of aliasing it to cancel", async () => {
    const { parseOnConflict } = await import("../../src/cli/on-conflict.ts");
    expect(() => parseOnConflict("abort")).toThrow("Invalid --on-conflict value: abort.");
    expect(() => parseOnConflict("abort")).toThrow("Use replace, skip, prompt or cancel.");
    expect(parseOnConflict("fail")).toBe("cancel");
  });
});
