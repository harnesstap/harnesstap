import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("profile use keep summary", () => {
  it("counts kept files when a switch writes and removes nothing", async () => {
    const context = await createTestContext("cli-keep-summary");
    try {
      mkdirSync(join(context.homeDir, ".codex/agents"), { recursive: true });
      mkdirSync(join(context.homeDir, ".claude/rules"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".codex/agents/codex-explorer.toml"),
        "name = \"codex-explorer\"\n",
      );
      writeFileSync(join(context.homeDir, ".claude/rules/security.md"), "# security\n");

      await runCli(["init", "--no-interactive", "--harnesses", "claude-code,codex"]);
      await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--on-conflict",
        "replace",
      ]);
      await runCli(["profile", "create", "work", "--no-interactive"]);

      const switched = await runCli([
        "profile",
        "use",
        "work",
        "--no-interactive",
        "--on-conflict",
        "replace",
      ]);
      expect(switched.exitCode ?? 0).toBe(0);
      expect(switched.stdout).toContain("Wrote 0, removed 0, kept 2.");
      expect(switched.stdout).toContain(".codex/agents/codex-explorer.toml");
      expect(switched.stdout).toContain(".claude/rules/security.md");
      expect(switched.stdout).not.toContain("Everything is up to date. 0 unchanged.");
    } finally {
      await context.cleanup();
    }
  });
});
