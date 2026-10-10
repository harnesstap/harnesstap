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
    const { formatHintCommand } = await import("../../src/cli/shared.ts");
    expect(
      formatHintCommand(["resource", "scope", "filesystem", "--add", "claude-code,cursor"]),
    ).toBe("ht resource scope filesystem --add claude-code,cursor");
    expect(formatHintCommand(["profile", "use", "global default"])).toBe(
      'ht profile use "global default"',
    );
  });
});
