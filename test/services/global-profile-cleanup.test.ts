import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.js";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import {
  collectOrphanSkillFilesOnDisk,
  expandStaleMcpConfigMirrors,
  expandStaleSkillHubMirrors,
  planStaleGlobalProfileFiles,
} from "../../src/services/global-profile-cleanup.ts";

describe("global-profile-cleanup service", () => {
  it("detects skill directories on disk that are not part of the desired profile", async () => {
    const context = await createInitializedTestContext("global-profile-cleanup-orphans");
    try {
      mkdirSync(join(context.homeDir, ".claude", "skills", "dbt-only"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude/skills/dbt-only/SKILL.md"),
        "# dbt only",
        "utf-8",
      );

      const orphans = collectOrphanSkillFilesOnDisk(
        context.homeDir,
        ["claude-code"],
        new Set([".claude/skills/kept/SKILL.md"]),
      );

      expect(orphans).toEqual([".claude/skills/dbt-only/SKILL.md"]);
    } finally {
      await context.cleanup();
    }
  });

  it("expands removed managed skills onto the shared ~/.agents/skills hub", () => {
    expect(
      expandStaleSkillHubMirrors(
        [".claude/skills/caveman/SKILL.md", ".cursor/skills/caveman/SKILL.md"],
        new Set(),
      ),
    ).toEqual([
      ".claude/skills/caveman/SKILL.md",
      ".cursor/skills/caveman/SKILL.md",
      ".agents/skills/caveman/SKILL.md",
    ]);

    expect(
      planStaleGlobalProfileFiles(
        "/tmp",
        [".claude/skills/kept/SKILL.md"],
        [".claude/skills/kept/SKILL.md", ".claude/skills/gone/SKILL.md"],
        ["claude-code"],
      ),
    ).toEqual([
      ".claude/skills/gone/SKILL.md",
      ".agents/skills/gone/SKILL.md",
    ]);

    // Keep the hub when the incoming profile still owns the skill under any path.
    expect(
      expandStaleSkillHubMirrors(
        [".claude/skills/caveman/SKILL.md"],
        new Set([".cursor/skills/caveman/SKILL.md"]),
      ),
    ).toEqual([".claude/skills/caveman/SKILL.md"]);
  });

  it("expands removed MCP configs onto other harness dedicated MCP paths", () => {
    expect(
      expandStaleMcpConfigMirrors(
        [".cursor/mcp.json"],
        new Set(),
        ["cursor", "copilot-cli"],
      ),
    ).toEqual([".cursor/mcp.json", ".copilot/mcp-config.json"]);

    // Do not wipe sibling MCP configs when the incoming profile still manages MCP.
    expect(
      expandStaleMcpConfigMirrors(
        [".claude/CLAUDE.md"],
        new Set([".cursor/mcp.json"]),
        ["cursor", "copilot-cli"],
      ),
    ).toEqual([".claude/CLAUDE.md"]);

    expect(
      planStaleGlobalProfileFiles(
        "/tmp",
        [],
        [".cursor/mcp.json", ".claude/CLAUDE.md"],
        ["cursor", "copilot-cli"],
      ),
    ).toContain(".copilot/mcp-config.json");
  });

  it("leaves not-staged skill directories on disk when re-applying the same profile", async () => {
    const context = await createInitializedTestContext("global-profile-cleanup-reapply");
    try {
      const profile = createLayer({ name: "default" });
      setLayerTags(profile.id, ["profile"]);
      addResourceToLayer(
        profile.id,
        createResource({
          type: "skill",
          name: "kept-skill",
          description: "kept",
          content: "# kept",
          metadata: {},
          source: "manual",
        }).id,
      );

      await applyProfileLayer("default", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("default");

      const notStagedPath = join(
        context.homeDir,
        ".claude/skills/building-dbt-semantic-layer/SKILL.md",
      );
      mkdirSync(dirname(notStagedPath), { recursive: true });
      writeFileSync(notStagedPath, "# dbt semantic layer", "utf-8");

      const reapplied = await applyProfileLayer("default", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(existsSync(notStagedPath)).toBe(true);
      expect(reapplied.removed_files ?? []).not.toContain(
        ".claude/skills/building-dbt-semantic-layer/SKILL.md",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("removes managed skill A but leaves not-staged skill B when switching to an empty profile", async () => {
    const context = await createInitializedTestContext("global-profile-cleanup-a-b-switch");
    try {
      const profile1 = createLayer({ name: "profile-1" });
      setLayerTags(profile1.id, ["profile"]);
      addResourceToLayer(
        profile1.id,
        createResource({
          type: "skill",
          name: "skill-a",
          description: "managed",
          content: "# Skill A",
          metadata: {},
          source: "manual",
        }).id,
      );

      const profile2 = createLayer({ name: "profile-2" });
      setLayerTags(profile2.id, ["profile"]);

      await applyProfileLayer("profile-1", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-1");

      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      const skillBPath = join(context.homeDir, ".claude/skills/skill-b/SKILL.md");
      expect(existsSync(skillAPath)).toBe(true);
      mkdirSync(dirname(skillBPath), { recursive: true });
      writeFileSync(skillBPath, "# Skill B", "utf-8");

      const switched = await applyProfileLayer("profile-2", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(existsSync(skillAPath)).toBe(false);
      expect(existsSync(skillBPath)).toBe(true);
      expect(switched.removed_files).toContain(".claude/skills/skill-a/SKILL.md");
      expect(switched.removed_files).toContain(".agents/skills/skill-a/SKILL.md");
      expect(switched.removed_files ?? []).not.toContain(
        ".claude/skills/skill-b/SKILL.md",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("removes the shared hub copy when switching away from a profile that managed the skill", async () => {
    const context = await createInitializedTestContext("global-profile-cleanup-hub-mirror");
    try {
      const profile1 = createLayer({ name: "with-skills" });
      setLayerTags(profile1.id, ["profile"]);
      addResourceToLayer(
        profile1.id,
        createResource({
          type: "skill",
          name: "caveman",
          description: "managed",
          content: "# Caveman",
          metadata: {},
          source: "manual",
        }).id,
      );

      const profile2 = createLayer({ name: "plugin-only" });
      setLayerTags(profile2.id, ["profile"]);

      await applyProfileLayer("with-skills", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("with-skills");

      const managedPath = join(context.homeDir, ".claude/skills/caveman/SKILL.md");
      const hubPath = join(context.homeDir, ".agents/skills/caveman/SKILL.md");
      const notStagedHubPath = join(
        context.homeDir,
        ".agents/skills/unrelated/SKILL.md",
      );
      expect(existsSync(managedPath)).toBe(true);
      mkdirSync(dirname(hubPath), { recursive: true });
      writeFileSync(hubPath, "# Caveman hub", "utf-8");
      mkdirSync(dirname(notStagedHubPath), { recursive: true });
      writeFileSync(notStagedHubPath, "# not staged", "utf-8");

      const switched = await applyProfileLayer("plugin-only", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(existsSync(managedPath)).toBe(false);
      expect(existsSync(hubPath)).toBe(false);
      expect(existsSync(notStagedHubPath)).toBe(true);
      expect(switched.removed_files).toContain(".claude/skills/caveman/SKILL.md");
      expect(switched.removed_files).toContain(".agents/skills/caveman/SKILL.md");
      expect(switched.removed_files ?? []).not.toContain(
        ".agents/skills/unrelated/SKILL.md",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("removes sibling harness MCP configs when switching away from a profile that managed MCP", async () => {
    const context = await createInitializedTestContext("global-profile-cleanup-mcp-mirror");
    try {
      const profile1 = createLayer({ name: "with-mcp" });
      setLayerTags(profile1.id, ["profile"]);
      addResourceToLayer(
        profile1.id,
        createResource({
          type: "mcp_server",
          name: "devel",
          description: "managed",
          content: "",
          metadata: {
            transport: "http",
            url: "https://example.com/sse",
          },
          source: "~/.cursor/mcp.json",
        }).id,
      );

      const profile2 = createLayer({ name: "plugin-only" });
      setLayerTags(profile2.id, ["profile"]);

      await applyProfileLayer("with-mcp", {
        harness: "cursor",
        conflictPolicy: "replace",
      });
      setActiveProfileName("with-mcp");

      const cursorMcp = join(context.homeDir, ".cursor/mcp.json");
      const copilotMcp = join(context.homeDir, ".copilot/mcp-config.json");
      expect(existsSync(cursorMcp)).toBe(true);
      mkdirSync(dirname(copilotMcp), { recursive: true });
      writeFileSync(
        copilotMcp,
        JSON.stringify({
          mcpServers: {
            devel: { type: "sse", url: "https://example.com/sse", tools: ["*"] },
          },
        }),
        "utf-8",
      );

      const switched = await applyProfileLayer("plugin-only", {
        harness: "cursor,copilot-cli",
        conflictPolicy: "replace",
      });

      expect(existsSync(cursorMcp)).toBe(false);
      expect(existsSync(copilotMcp)).toBe(false);
      expect(switched.removed_files).toContain(".cursor/mcp.json");
      expect(switched.removed_files).toContain(".copilot/mcp-config.json");
    } finally {
      await context.cleanup();
    }
  });
});
