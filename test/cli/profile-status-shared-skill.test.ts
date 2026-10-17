import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

const SHARED_SKILL = `---
name: shared-skill
description: Skill in ~/.agents/skills
---
Shared body.
`;

const AGENTS_SKILL = ".agents/skills/shared-skill/SKILL.md";
const CURSOR_SKILL = ".cursor/skills/shared-skill/SKILL.md";

describe("profile status with a skill Cursor reads from ~/.agents/skills", () => {
  it("agrees with apply that nothing is missing", async () => {
    const context = await createTestContext("cli-status-shared-skill");
    try {
      mkdirSync(join(context.homeDir, ".agents/skills/shared-skill"), { recursive: true });
      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(join(context.homeDir, AGENTS_SKILL), SHARED_SKILL);
      writeFileSync(join(context.homeDir, ".cursor/mcp.json"), '{"mcpServers":{}}\n');
      // Codex reads ~/.agents/skills, so init imports shared-skill from there.
      mkdirSync(join(context.homeDir, ".codex"), { recursive: true });
      writeFileSync(join(context.homeDir, ".codex/config.toml"), 'model = "gpt-5"\n');

      await runCli(["init", "--no-interactive"]);
      await runCli(["harness", "set", "--harnesses", "claude-code,cursor"]);
      const listed = await runCli(["resource", "list", "--format", "json"]);
      expect(listed.stdout).toContain("shared-skill");
      const applied = await runCli(["profile", "use", "global default", "--no-interactive"]);
      expect(applied.exitCode ?? 0).toBe(0);
      expect(existsSync(join(context.homeDir, CURSOR_SKILL))).toBe(false);

      const dryRun = await runCli(["profile", "use", "global default", "--dry-run", "--no-interactive"]);
      expect(dryRun.stdout).not.toContain(CURSOR_SKILL);

      const status = await runCli(["profile", "status", "--format", "json"]);
      const payload = JSON.parse(status.stdout) as {
        has_drift: boolean;
        changes: Array<{ path: string }>;
      };
      expect(payload.changes.map((change) => change.path)).not.toContain(CURSOR_SKILL);
      expect(payload.has_drift).toBe(false);

      const human = await runCli(["profile", "status"]);
      expect(human.stdout).toContain("in sync");

      const preview = await runCli(["profile", "preview", "--format", "json"]);
      const previewPayload = JSON.parse(preview.stdout) as {
        files: { changes: Array<{ path: string }> };
      };
      expect(previewPayload.files.changes.map((change) => change.path)).not.toContain(CURSOR_SKILL);
    } finally {
      await context.cleanup();
    }
  });
});
