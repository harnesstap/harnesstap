import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

const TINY_SKILL = `---
name: tiny-skill
description: Small skill
---
Say hello politely. TINY-BODY-MARKER
`;

const SEED_MCP = `{ "mcpServers": { "cursor-mcp": { "command": "node", "args": ["server.js"], "env": { "TOKEN": "\${CURSOR_TOKEN}" } } } }
`;

function seedHome(homeDir: string): void {
  mkdirSync(join(homeDir, ".claude/skills/tiny-skill"), { recursive: true });
  mkdirSync(join(homeDir, ".agents/skills/tiny-skill"), { recursive: true });
  mkdirSync(join(homeDir, ".cursor"), { recursive: true });
  mkdirSync(join(homeDir, ".codex"), { recursive: true });
  writeFileSync(join(homeDir, ".claude/skills/tiny-skill/SKILL.md"), TINY_SKILL);
  writeFileSync(join(homeDir, ".agents/skills/tiny-skill/SKILL.md"), TINY_SKILL);
  writeFileSync(join(homeDir, ".cursor/mcp.json"), SEED_MCP);
  writeFileSync(
    join(homeDir, ".codex/config.toml"),
    'model = "gpt-5"\n[mcp_servers.codex-mcp]\ncommand = "uvx"\nargs = ["codex-mcp-server"]\n',
  );
}

describe("CLI profile drift from a seeded HOME", () => {
  it("does not rewrite semantically equal mcp.json or flag untouched config.toml", async () => {
    const context = await createTestContext("cli-profile-false-drift-seed");
    try {
      seedHome(context.homeDir);
      await runCli(["init", "--no-interactive"]);

      const pending = await runCli(["profile", "status"]);
      expect(pending.stdout).toContain('ht profile use "global default"');

      const applied = await runCli(["profile", "use", "global default", "--no-interactive"]);
      expect(applied.exitCode ?? 0).toBe(0);
      expect(applied.stdout).toContain("Snapshot saved");
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(SEED_MCP);
      expect(applied.stdout).not.toContain(".cursor/mcp.json");

      const status = await runCli(["profile", "status", "--format", "json"]);
      const payload = JSON.parse(status.stdout) as {
        applied: boolean;
        has_drift: boolean;
        snapshot_id: string | null;
        changes: Array<{ path: string }>;
      };
      expect(payload.applied).toBe(true);
      expect(payload.has_drift).toBe(false);
      expect(payload.snapshot_id).toBeTruthy();
      expect(payload.changes.map((change) => change.path)).not.toContain(".codex/config.toml");
      expect(payload.changes).toEqual([]);

      const check = await runCli(["profile", "status", "--check"]);
      expect(check.exitCode ?? 0).toBe(0);

      const human = await runCli(["profile", "status"]);
      expect(human.stdout).toContain("in sync");
      expect(human.stdout).not.toContain("has not been applied globally");

      await runCli(["profile", "create", "work"]);
      const switched = await runCli(["profile", "use", "work", "--no-interactive"]);
      expect(`${switched.stderr}${switched.stdout}`).not.toContain("unsaved change");
      expect(switched.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("reports the edited skill file, not an untouched .agents mirror", async () => {
    const context = await createTestContext("cli-profile-skill-mirror-drift");
    try {
      seedHome(context.homeDir);
      await runCli(["init", "--no-interactive"]);
      await runCli(["profile", "use", "global default", "--no-interactive"]);

      writeFileSync(
        join(context.homeDir, ".claude/skills/tiny-skill/SKILL.md"),
        `${TINY_SKILL}\nUSER EDIT\n`,
      );
      writeFileSync(
        join(context.homeDir, ".claude/skills/tiny-skill/notes.txt"),
        "keep me\n",
      );

      const status = await runCli(["profile", "status", "--format", "json"]);
      const payload = JSON.parse(status.stdout) as {
        changes: Array<{ path: string }>;
      };
      const paths = payload.changes.map((change) => change.path);
      expect(paths).toContain(".claude/skills/tiny-skill/SKILL.md");
      expect(paths).not.toContain(".agents/skills/tiny-skill/SKILL.md");

      await runCli(["profile", "create", "work"]);
      const stashed = await runCli([
        "profile",
        "use",
        "work",
        "--changes",
        "stash",
        "--no-interactive",
      ]);
      expect(`${stashed.stderr}${stashed.stdout}`).not.toContain("No untracked resources to stash");
      expect(stashed.exitCode ?? 0).toBe(0);
      expect(stashed.stdout).toContain("Stashed");
      expect(readFileSync(join(context.homeDir, ".claude/skills/tiny-skill/SKILL.md"), "utf-8")).toBe(
        TINY_SKILL,
      );
      expect(existsSync(join(context.homeDir, ".agents/skills/tiny-skill/SKILL.md"))).toBe(true);
      expect(readFileSync(join(context.homeDir, ".agents/skills/tiny-skill/SKILL.md"), "utf-8")).toBe(
        TINY_SKILL,
      );
      expect(readFileSync(join(context.homeDir, ".claude/skills/tiny-skill/notes.txt"), "utf-8")).toBe(
        "keep me\n",
      );

      const popped = await runCli(["profile", "stash", "pop", "--no-interactive"]);
      expect(popped.exitCode ?? 0).toBe(0);
      expect(
        readFileSync(join(context.homeDir, ".claude/skills/tiny-skill/SKILL.md"), "utf-8"),
      ).toContain("USER EDIT");
    } finally {
      await context.cleanup();
    }
  });
});
