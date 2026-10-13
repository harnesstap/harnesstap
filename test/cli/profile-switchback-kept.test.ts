import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

const TINY_SKILL = `---
name: tiny-skill
description: Small skill
---
Say hello politely.
`;

const AGENTS_SKILL = ".agents/skills/tiny-skill/SKILL.md";

describe("switch-back of a hand-edited managed file", () => {
  it("labels the file as kept, leaves it untouched, and stays in sync", async () => {
    const context = await createTestContext("cli-switchback-kept");
    try {
      mkdirSync(join(context.homeDir, ".claude/skills/tiny-skill"), { recursive: true });
      writeFileSync(join(context.homeDir, ".claude/skills/tiny-skill/SKILL.md"), TINY_SKILL);

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

      const scoped = await runCli(["resource", "scope", "tiny-skill", "--add", "codex"]);
      expect(scoped.exitCode ?? 0).toBe(0);
      const reapplied = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--on-conflict",
        "replace",
      ]);
      expect(reapplied.exitCode ?? 0).toBe(0);

      const skillPath = join(context.homeDir, AGENTS_SKILL);
      const edited = `${readFileSync(skillPath, "utf-8")}my hand edit\n`;
      writeFileSync(skillPath, edited);

      await runCli(["profile", "create", "work", "--no-interactive"]);
      const switched = await runCli([
        "profile",
        "use",
        "work",
        "--no-interactive",
        "--on-conflict",
        "replace",
        "--changes",
        "discard",
      ]);
      expect(switched.exitCode ?? 0).toBe(0);
      expect(readFileSync(skillPath, "utf-8")).toBe(edited);

      const preview = await runCli(["profile", "preview", "global default"]);
      expect(preview.exitCode ?? 0).toBe(0);
      expect(preview.stdout).toContain(`Kept. You changed it.  ${AGENTS_SKILL}`);
      expect(preview.stdout).not.toContain(`Will write  ${AGENTS_SKILL}`);
      expect(preview.stdout).toContain("0 would change · 1 kept");

      const json = await runCli(["profile", "preview", "global default", "--format", "json"]);
      const payload = JSON.parse(json.stdout) as {
        files: { changes: Array<{ path: string; type: string; removal_group?: string }> };
        removals: { owned_modified: string[] };
      };
      const skillChange = payload.files.changes.find((change) => change.path === AGENTS_SKILL);
      expect(skillChange?.type).toBe("modified");
      expect(skillChange?.removal_group).toBe("owned_modified");
      expect(payload.removals.owned_modified).toContain(AGENTS_SKILL);

      const back = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
      ]);
      expect(back.exitCode ?? 0).toBe(0);
      expect(back.stdout + back.stderr).not.toContain("would change");
      expect(readFileSync(skillPath, "utf-8")).toBe(edited);

      const status = await runCli(["profile", "status"]);
      expect(status.exitCode ?? 0).toBe(0);
      expect(status.stdout).toContain("in sync");
      expect(status.stdout).not.toContain("out of sync");

      const statusJson = await runCli(["profile", "status", "--format", "json"]);
      const statusPayload = JSON.parse(statusJson.stdout) as {
        has_drift: boolean;
        applied: boolean;
        changes: Array<{ path: string; removal_group?: string }>;
      };
      expect(statusPayload.applied).toBe(true);
      expect(statusPayload.has_drift).toBe(false);
      const statusChange = statusPayload.changes.find((change) => change.path === AGENTS_SKILL);
      expect(statusChange?.removal_group).toBe("owned_modified");
    } finally {
      await context.cleanup();
    }
  });
});
