import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("syncConfiguredHarnesses", () => {
  it("unions MCP and skills across configured harnesses with main-wins", async () => {
    const context = await createInitializedTestContext("harness-union-sync");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });

      writeTextFile(
        join(context.projectDir, ".claude/skills/alpha/SKILL.md"),
        "---\nname: alpha\n---\nclaude alpha\n",
      );
      writeTextFile(
        join(context.projectDir, ".agents/skills/alpha/SKILL.md"),
        "---\nname: alpha\n---\ncursor alpha\n",
      );
      writeTextFile(
        join(context.projectDir, ".cursor/mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
          },
        }, null, 2),
      );

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      const result = await syncConfiguredHarnesses({
        scope: "project",
        projectRoot: context.projectDir,
      });

      expect(result.platforms_synced.sort()).toEqual(["claude-code", "cursor"]);
      expect(result.conflicts.some((conflict) => conflict.identity === "skill:alpha:")).toBe(
        true,
      );

      const claudeSkill = readFileSync(
        join(context.projectDir, ".claude/skills/alpha/SKILL.md"),
        "utf8",
      );
      expect(claudeSkill).toContain("claude alpha");
      expect(claudeSkill).not.toContain("cursor alpha");

      const cursorMcp = readFileSync(join(context.projectDir, ".cursor/mcp.json"), "utf8");
      expect(cursorMcp).toContain("github");
      expect(existsSync(join(context.projectDir, ".mcp.json"))).toBe(true);
      const claudeMcp = readFileSync(join(context.projectDir, ".mcp.json"), "utf8");
      expect(claudeMcp).toContain("github");
    } finally {
      await context.cleanup();
    }
  });

  it("prefers .agents/skills and does not dual-write Grok native for the same skill", async () => {
    const context = await createInitializedTestContext("harness-union-agents");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({
        main_harness: "cursor",
        alias_harnesses: ["grok-build"],
      });

      writeTextFile(
        join(context.projectDir, ".agents/skills/shared/SKILL.md"),
        "---\nname: shared\n---\nshared body\n",
      );
      writeTextFile(
        join(context.projectDir, ".grok/skills/shared/SKILL.md"),
        "---\nname: shared\n---\ngrok body\n",
      );

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      const result = await syncConfiguredHarnesses({
        scope: "project",
        projectRoot: context.projectDir,
      });

      expect(result.files).toContain(".agents/skills/shared/SKILL.md");
      expect(result.files.some((path) => path.startsWith(".grok/skills/shared/"))).toBe(
        false,
      );
      const agents = readFileSync(
        join(context.projectDir, ".agents/skills/shared/SKILL.md"),
        "utf8",
      );
      expect(agents).toContain("shared body");
    } finally {
      await context.cleanup();
    }
  });
});
