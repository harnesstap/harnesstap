import { describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("syncConfiguredHarnesses", () => {
  it("unions MCP and skills across registered harnesses with last-write", async () => {
    const context = await createInitializedTestContext("harness-union-sync");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"],
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
      expect(claudeSkill).toContain("cursor alpha");
      expect(claudeSkill).not.toContain("claude alpha");
      expect(result.conflict_policy).toBe("last-write");

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
      setHarnessPreference({ registered_harnesses: ["cursor", "grok-build"],
      });

      writeTextFile(
        join(context.projectDir, ".grok/skills/shared/SKILL.md"),
        "---\nname: shared\n---\ngrok body\n",
      );
      const agentsSkill = join(context.projectDir, ".agents/skills/shared/SKILL.md");
      writeTextFile(
        agentsSkill,
        "---\nname: shared\n---\nshared body\n",
      );
      const newer = Date.now() / 1000 + 60;
      utimesSync(agentsSkill, newer, newer);

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
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"],
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
      writeTextFile(
        join(context.homeDir, ".cursor/plugins/installed.json"),
        JSON.stringify({ plugins: ["extra@cursor-public"] }),
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
        ".cursor/plugins/local/demo/skills/hello/SKILL.md",
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
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"],
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

  it("extracts Cursor/Claude plugin skills into .agents for OpenCode", async () => {
    const context = await createInitializedTestContext("harness-union-plugin-agents");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["claude-code", "opencode"],
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
        "---\nname: hello\ndescription: Plugin hello\n---\nHello from a Claude plugin.\n",
      );
      writeTextFile(
        join(
          context.homeDir,
          ".claude/plugins/cache/demo-market/demo/1.0.0/agents/reviewer.md",
        ),
        "---\nname: reviewer\n---\nReview carefully.\n",
      );
      writeTextFile(
        join(
          context.homeDir,
          ".claude/plugins/cache/demo-market/demo/1.0.0/commands/ping.md",
        ),
        "Ping the plugin.\n",
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

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      const result = await syncConfiguredHarnesses({
        scope: "global",
        homeRoot: context.homeDir,
        pluginResourceMode: "symlink",
      });

      expect(result.plugin_resource_mode).toBe("symlink");
      expect(result.files).toContain(".agents/skills/hello/SKILL.md");

      const hubSkill = join(context.homeDir, ".agents/skills/hello");
      expect(existsSync(join(hubSkill, "SKILL.md"))).toBe(true);
      expect(lstatSync(hubSkill).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(hubSkill, "SKILL.md"), "utf8")).toContain(
        "Hello from a Claude plugin.",
      );
      expect(existsSync(join(context.homeDir, ".claude/skills/hello/SKILL.md"))).toBe(
        false,
      );

      const agentPath = join(
        context.homeDir,
        ".config/opencode/agents/reviewer.md",
      );
      expect(existsSync(agentPath)).toBe(true);
      expect(readFileSync(agentPath, "utf8")).toContain("Review carefully.");

      const commandPath = join(
        context.homeDir,
        ".config/opencode/commands/ping.md",
      );
      expect(existsSync(commandPath)).toBe(true);
      expect(readFileSync(commandPath, "utf8")).toContain("Ping the plugin.");

      const skillMarker = join(hubSkill, ".harnesstap");
      expect(existsSync(skillMarker)).toBe(true);
      const marker = JSON.parse(readFileSync(skillMarker, "utf8")) as {
        entries: Array<{ origin_ref: string; type: string; name: string }>;
      };
      expect(marker.entries[0]?.origin_ref).toBe("demo@demo-market");
      expect(marker.entries[0]?.type).toBe("skill");
      expect(marker.entries[0]?.name).toBe("hello");

      const { scanHomeDefaults } = await import("../../src/services/scanner.ts");
      const scanned = await scanHomeDefaults(undefined, context.homeDir);
      const opencode = scanned.find((entry) => entry.platformId === "opencode");
      expect(
        opencode?.resources.some(
          (resource) => resource.type === "skill" && resource.name === "hello",
        ),
      ).toBe(false);
      expect(
        opencode?.resources.some(
          (resource) => resource.type === "agent" && resource.name === "reviewer",
        ),
      ).toBe(false);
      expect(
        opencode?.resources.some(
          (resource) => resource.type === "command" && resource.name === "ping",
        ),
      ).toBe(false);

      const { listResources } = await import("../../src/models/resource.ts");
      expect(
        listResources().some(
          (resource) => resource.type === "skill" && resource.name === "hello",
        ),
      ).toBe(false);

      const { getHarnessInventory } = await import(
        "../../src/services/harness-inventory.ts"
      );
      const inventory = getHarnessInventory(context.homeDir);
      const namesOfType = (harnessId: string, type: string): string[] =>
        inventory.harnesses
          .find((entry) => entry.id === harnessId)
          ?.locations.flatMap((location) =>
            location.resources
              .filter((resource) => resource.type === type)
              .map((resource) => resource.name),
          )
          .sort() ?? [];

      expect(namesOfType("claude-code", "plugin")).toContain("demo");
      expect(namesOfType("claude-code", "skill")).not.toContain("hello");
      expect(namesOfType("opencode", "skill")).not.toContain("hello");
    } finally {
      await context.cleanup();
    }
  });

  it("copies plugin skills into .agents when pluginResources is copy", async () => {
    const context = await createInitializedTestContext("harness-union-plugin-copy");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["claude-code", "opencode"],
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
        "---\nname: hello\n---\nCopied plugin skill.\n",
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

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      await syncConfiguredHarnesses({
        scope: "global",
        homeRoot: context.homeDir,
        pluginResourceMode: "copy",
      });

      const hubSkill = join(context.homeDir, ".agents/skills/hello");
      expect(lstatSync(hubSkill).isSymbolicLink()).toBe(false);
      expect(lstatSync(hubSkill).isDirectory()).toBe(true);
      expect(readFileSync(join(hubSkill, "SKILL.md"), "utf8")).toContain(
        "Copied plugin skill.",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("makes CLAUDE.md a symlink to AGENTS.md when instruction content matches", async () => {
    const context = await createInitializedTestContext("harness-union-instruction-link");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["claude-code", "opencode"],
      });

      writeTextFile(
        join(context.projectDir, "CLAUDE.md"),
        "Use the shared instruction file.\n",
      );

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      await syncConfiguredHarnesses({
        scope: "project",
        projectRoot: context.projectDir,
        pluginResourceMode: "symlink",
      });

      const agents = join(context.projectDir, "AGENTS.md");
      const claude = join(context.projectDir, "CLAUDE.md");
      expect(existsSync(agents)).toBe(true);
      expect(lstatSync(agents).isSymbolicLink()).toBe(false);
      expect(lstatSync(claude).isSymbolicLink()).toBe(true);
      expect(readFileSync(claude, "utf8")).toContain("Use the shared instruction file.");
      expect(readFileSync(agents, "utf8")).toContain("Use the shared instruction file.");
    } finally {
      await context.cleanup();
    }
  });

  it("dry-run succeeds for official Claude cache plugins without plugin.json", async () => {
    const context = await createInitializedTestContext("harness-union-gopls-lsp");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["claude-code", "opencode"],
      });

      const installRoot =
        ".claude/plugins/cache/claude-plugins-official/gopls-lsp/1.0.0";
      writeTextFile(
        join(context.homeDir, installRoot, "LICENSE"),
        "Apache-2.0\n",
      );
      writeTextFile(
        join(context.homeDir, installRoot, "README.md"),
        "# gopls-lsp\n",
      );
      writeTextFile(
        join(context.homeDir, ".claude/plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "gopls-lsp@claude-plugins-official": [
              {
                scope: "user",
                installPath: "cache/claude-plugins-official/gopls-lsp/1.0.0",
                version: "1.0.0",
              },
            ],
          },
        }),
      );

      const { syncConfiguredHarnesses } = await import(
        "../../src/services/harness-union-sync.ts"
      );
      const result = await syncConfiguredHarnesses({
        scope: "global",
        homeRoot: context.homeDir,
        dryRun: true,
      });

      expect(result.platforms_synced.sort()).toEqual(["claude-code", "opencode"]);
      expect(result.harness_changes.every((row) => row.changes >= 0)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
