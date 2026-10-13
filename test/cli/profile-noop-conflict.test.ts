import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  mkdirSync(join(homeDir, ".cursor"), { recursive: true });
  writeFileSync(join(homeDir, ".claude/skills/tiny-skill/SKILL.md"), TINY_SKILL);
  writeFileSync(join(homeDir, ".cursor/mcp.json"), SEED_MCP);
}

describe("plain profile use on a seeded HOME", () => {
  it("does not cancel a semantic no-op, and a real conflict names the file", async () => {
    const context = await createTestContext("cli-profile-noop-conflict");
    try {
      seedHome(context.homeDir);
      await runCli([
        "init",
        "--no-interactive",
        "--harnesses",
        "claude-code,cursor",
      ]);

      const dryRun = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--dry-run",
      ]);
      expect(dryRun.exitCode ?? 0).toBe(0);
      expect(`${dryRun.stdout}${dryRun.stderr}`).not.toContain("cancelled");

      const applied = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
      ]);
      expect(applied.exitCode ?? 0).toBe(0);
      expect(applied.stdout).toContain("up to date");
      expect(applied.stdout).not.toContain("cancelled");
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(SEED_MCP);

      const again = await runCli(["apply", "global default", "--global", "--no-interactive"]);
      expect(again.exitCode ?? 0).toBe(0);
      expect(`${again.stdout}${again.stderr}`).not.toContain("cancelled");
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(SEED_MCP);

      const edited = '{ "mcpServers": { "other": { "command": "nope" } } }\n';
      writeFileSync(join(context.homeDir, ".cursor/mcp.json"), edited);
      const cancelled = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
      ]);
      expect(cancelled.exitCode).toBe(1);
      expect(cancelled.stdout).toContain(
        "Profile apply cancelled. .cursor/mcp.json would change.",
      );
      expect(cancelled.stdout).toContain("Use --on-conflict replace to replace it.");
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(edited);

      const dryConflict = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--dry-run",
      ]);
      expect(dryConflict.exitCode ?? 0).toBe(0);
      expect(dryConflict.stdout).toContain("Would write");
      expect(dryConflict.stdout).toContain(".cursor/mcp.json");
      expect(`${dryConflict.stdout}${dryConflict.stderr}`).not.toContain("cancelled");
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(edited);

      const json = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--format",
        "json",
      ]);
      expect(json.exitCode).toBe(1);
      const payload = JSON.parse(json.stdout) as {
        cancelled: boolean;
        conflicts: string[];
        written_files: string[];
      };
      expect(payload.cancelled).toBe(true);
      expect(payload.conflicts).toContain(".cursor/mcp.json");
      expect(payload.written_files).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("lists both conflicting files on dry-run and says replace them", async () => {
    const context = await createTestContext("cli-profile-two-file-conflict");
    try {
      seedHome(context.homeDir);
      mkdirSync(join(context.homeDir, ".codex"), { recursive: true });
      const seededToml =
        'model = "gpt-5"\n[mcp_servers.codex-mcp]\ncommand = "uvx"\nargs = ["codex-mcp-server"]\n';
      writeFileSync(join(context.homeDir, ".codex/config.toml"), seededToml);
      await runCli([
        "init",
        "--no-interactive",
        "--harnesses",
        "claude-code,cursor,codex",
      ]);
      const applied = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
      ]);
      expect(applied.exitCode ?? 0).toBe(0);

      const mcpPath = join(context.homeDir, ".cursor/mcp.json");
      const tomlPath = join(context.homeDir, ".codex/config.toml");
      const editedMcp = '{ "mcpServers": { "other": { "command": "nope" } } }\n';
      const editedToml = 'model = "user-edit"\n';
      writeFileSync(mcpPath, editedMcp);
      writeFileSync(tomlPath, editedToml);

      const dryRun = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
        "--dry-run",
      ]);
      expect(dryRun.exitCode ?? 0).toBe(0);
      expect(dryRun.stdout).toContain("Would write");
      expect(dryRun.stdout).toContain(".cursor/mcp.json");
      expect(dryRun.stdout).toContain(".codex/config.toml");
      expect(`${dryRun.stdout}${dryRun.stderr}`).not.toContain("cancelled");
      expect(readFileSync(mcpPath, "utf-8")).toBe(editedMcp);
      expect(readFileSync(tomlPath, "utf-8")).toBe(editedToml);

      const cancelled = await runCli([
        "profile",
        "use",
        "global default",
        "--no-interactive",
      ]);
      expect(cancelled.exitCode).toBe(1);
      expect(cancelled.stdout).toContain(".cursor/mcp.json");
      expect(cancelled.stdout).toContain(".codex/config.toml");
      expect(cancelled.stdout).toContain("Use --on-conflict replace to replace them.");
      expect(cancelled.stdout).not.toContain("replace it.");
      expect(readFileSync(mcpPath, "utf-8")).toBe(editedMcp);
      expect(readFileSync(tomlPath, "utf-8")).toBe(editedToml);
    } finally {
      await context.cleanup();
    }
  });
});
