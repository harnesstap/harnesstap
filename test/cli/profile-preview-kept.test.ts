import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("profile preview removal labels", () => {
  it("labels unmanaged files as kept, matching the confirm groups", async () => {
    const context = await createTestContext("cli-preview-kept");
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
      await runCli(["profile", "create", "work"]);

      const preview = await runCli(["profile", "preview", "work"]);
      expect(preview.exitCode ?? 0).toBe(0);
      expect(preview.stdout).toContain("Kept. Not made by HarnessTap.  .codex/agents/codex-explorer.toml");
      expect(preview.stdout).toContain("Kept. Not made by HarnessTap.  .claude/rules/security.md");
      expect(preview.stdout).not.toContain("Will write  .codex/agents/codex-explorer.toml");
      expect(preview.stdout).not.toContain("Will remove  .claude/rules/security.md");

      const json = await runCli(["profile", "preview", "work", "--format", "json"]);
      const payload = JSON.parse(json.stdout) as {
        files: { changes: Array<{ path: string; removal_group?: string }> };
        removals: { unmanaged: string[] };
      };
      const explorer = payload.files.changes.find(
        (change) => change.path === ".codex/agents/codex-explorer.toml",
      );
      expect(explorer?.removal_group).toBe("unmanaged");
      expect(payload.removals.unmanaged).toContain(".codex/agents/codex-explorer.toml");
      expect(payload.removals.unmanaged).toContain(".claude/rules/security.md");
    } finally {
      await context.cleanup();
    }
  });
});
