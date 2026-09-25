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

  it("copies host plugin install trees between Claude and Cursor on global sync", async () => {
    const context = await createInitializedTestContext("harness-union-plugins");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });

      writeTextFile(
        join(
          context.homeDir,
          ".claude/plugins/cache/demo-market/demo/1.0.0/.claude-plugin/plugin.json",
        ),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
      );
      writeTextFile(
        join(
          context.homeDir,
          ".claude/plugins/cache/demo-market/demo/1.0.0/skills/hello/SKILL.md",
        ),
        "---\nname: hello\n---\nClaude plugin skill\n",
      );
      writeTextFile(
        join(context.homeDir, ".claude/plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "demo@demo-market": [
              {
                scope: "user",
                installPath: "cache/demo-market/demo/1.0.0",
                version: "1.0.0",
              },
            ],
          },
        }),
      );

      writeTextFile(
        join(
          context.homeDir,
          ".cursor/plugins/cache/cursor-public/extra/aaaa/.cursor-plugin/plugin.json",
        ),
        JSON.stringify({ name: "extra", version: "9.0.0" }),
      );
      writeTextFile(
        join(
          context.homeDir,
          ".cursor/plugins/cache/cursor-public/extra/aaaa/skills/extra/SKILL.md",
        ),
        "---\nname: extra\n---\nCursor plugin skill\n",
      );

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      const result = await syncConfiguredHarnesses({
        scope: "global",
        homeRoot: context.homeDir,
      });

      expect(result.platforms_synced.sort()).toEqual(["claude-code", "cursor"]);

      const cursorCopy = join(
        context.homeDir,
        ".cursor/plugins/cache/demo-market/demo/1.0.0/skills/hello/SKILL.md",
      );
      expect(existsSync(cursorCopy)).toBe(true);
      expect(readFileSync(cursorCopy, "utf8")).toContain("Claude plugin skill");

      const claudeCopy = join(
        context.homeDir,
        ".claude/plugins/cache/cursor-public/extra/9.0.0/skills/extra/SKILL.md",
      );
      expect(existsSync(claudeCopy)).toBe(true);
      expect(readFileSync(claudeCopy, "utf8")).toContain("Cursor plugin skill");

      const installed = JSON.parse(
        readFileSync(
          join(context.homeDir, ".claude/plugins/installed_plugins.json"),
          "utf8",
        ),
      ) as { plugins: Record<string, unknown> };
      expect(installed.plugins["demo@demo-market"]).toBeDefined();
      expect(installed.plugins["extra@cursor-public"]).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("does not promote Claude local-scope MCP into project .mcp.json on harness sync", async () => {
    const context = await createInitializedTestContext("harness-union-local-mcp");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });

      writeTextFile(
        join(context.homeDir, ".claude.json"),
        JSON.stringify(
          {
            mcpServers: { docs: { command: "user-mcp" } },
            projects: {
              [context.projectDir]: {
                mcpServers: {
                  localOnly: { command: "npx", args: ["local-mcp"] },
                },
              },
            },
          },
          null,
          2,
        ),
      );
      writeTextFile(
        join(context.projectDir, ".cursor/mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: { command: "npx", args: ["-y", "github-mcp"] },
          },
        }, null, 2),
      );

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      await syncConfiguredHarnesses({
        scope: "project",
        projectRoot: context.projectDir,
      });

      const claudeMcp = JSON.parse(
        readFileSync(join(context.projectDir, ".mcp.json"), "utf8"),
      ) as { mcpServers: Record<string, unknown> };
      expect(claudeMcp.mcpServers.github).toBeDefined();
      expect(claudeMcp.mcpServers.localOnly).toBeUndefined();
      expect(claudeMcp.mcpServers.docs).toBeUndefined();

      const userJson = JSON.parse(
        readFileSync(join(context.homeDir, ".claude.json"), "utf8"),
      ) as {
        mcpServers: Record<string, unknown>;
        projects: Record<string, { mcpServers?: Record<string, unknown> }>;
      };
      expect(userJson.mcpServers.docs).toBeDefined();
      expect(userJson.mcpServers.localOnly).toBeUndefined();
      expect(userJson.projects[context.projectDir]?.mcpServers?.localOnly).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
