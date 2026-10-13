import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

const TINY_SKILL = `---
name: tiny-skill
description: Small skill
---
Say hello politely.
`;

const AGENTS_SKILL = ".agents/skills/tiny-skill/SKILL.md";

describe("profile preview and status after resource scope", () => {
  it("lists the new harness file after scope --add", async () => {
    const context = await createTestContext("cli-scope-preview");
    try {
      mkdirSync(join(context.homeDir, ".claude/skills/tiny-skill"), { recursive: true });
      mkdirSync(join(context.homeDir, ".codex"), { recursive: true });
      writeFileSync(join(context.homeDir, ".claude/skills/tiny-skill/SKILL.md"), TINY_SKILL);
      writeFileSync(join(context.homeDir, ".codex/config.toml"), 'model = "gpt-5"\n');

      await runCli([
        "init",
        "--no-interactive",
        "--harnesses",
        "claude-code,codex",
      ]);
      const applied = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--on-conflict",
        "replace",
      ]);
      expect(applied.exitCode ?? 0).toBe(0);
      expect(existsSync(join(context.homeDir, AGENTS_SKILL))).toBe(false);

      const before = await runCli(["profile", "preview", "--format", "json"]);
      const beforePreview = JSON.parse(before.stdout) as {
        files: { changes: Array<{ path: string }> };
      };
      expect(beforePreview.files.changes.map((change) => change.path)).not.toContain(AGENTS_SKILL);

      const scoped = await runCli([
        "resource",
        "scope",
        "tiny-skill",
        "--add",
        "codex",
      ]);
      expect(scoped.exitCode ?? 0).toBe(0);

      const preview = await runCli(["profile", "preview", "--format", "json"]);
      const previewPayload = JSON.parse(preview.stdout) as {
        files: { changes: Array<{ path: string; type: string }> };
      };
      const skillChange = previewPayload.files.changes.find((change) => change.path === AGENTS_SKILL);
      expect(skillChange?.type).toBe("deleted");

      const human = await runCli(["profile", "preview"]);
      expect(human.stdout).toContain("Will write");
      expect(human.stdout).toContain(AGENTS_SKILL);

      const status = await runCli(["profile", "status", "--format", "json"]);
      const statusPayload = JSON.parse(status.stdout) as {
        has_drift: boolean;
        changes: Array<{ path: string; type: string }>;
      };
      expect(statusPayload.has_drift).toBe(true);
      expect(statusPayload.changes.map((change) => change.path)).toContain(AGENTS_SKILL);

      const statusHuman = await runCli(["profile", "status"]);
      expect(statusHuman.stdout).toContain("out of sync");
      expect(statusHuman.stdout).toContain(AGENTS_SKILL);

      const dryRun = await runCli([
        "profile",
        "use",
        "global default",
        "--dry-run",
        "--no-interactive",
        "--on-conflict",
        "replace",
      ]);
      expect(dryRun.exitCode ?? 0).toBe(0);
      expect(dryRun.stdout).toContain(AGENTS_SKILL);
      expect(existsSync(join(context.homeDir, AGENTS_SKILL))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
