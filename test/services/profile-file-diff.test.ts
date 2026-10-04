import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { getManagedFileDiff } from "../../src/services/profile-file-diff.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("getManagedFileDiff", () => {
  it("returns expected snapshot content and drifted live content", async () => {
    const context = await createInitializedTestContext("managed-file-diff");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const relative = ".claude/skills/manual-skill/SKILL.md";
      const absolute = join(context.homeDir, relative);
      const drifted =
        "---\nname: manual-skill\ndescription: x\n---\n\n# drifted\n";
      writeFileSync(absolute, drifted, "utf-8");

      const result = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });

      expect(result.path).toBe(relative);
      expect(result.absolute_path).toBe(absolute);
      expect(result.expected).toContain("# original");
      expect(result.current).toBe(drifted);
    } finally {
      await context.cleanup();
    }
  });

  it("does not wipe extra live skill body when the profile snapshot is a subset", async () => {
    const context = await createInitializedTestContext("managed-file-diff-subset");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "skill",
          name: "dolibarr-development",
          description: "short",
          content: "",
          metadata: {},
          source: "manual",
        }).id,
      );

      const relative = ".claude/skills/dolibarr-development/SKILL.md";
      const absolute = join(context.homeDir, relative);
      mkdirSync(join(context.homeDir, ".claude", "skills", "dolibarr-development"), {
        recursive: true,
      });
      const live = [
        "---",
        "name: dolibarr-development",
        "description: short",
        "allowed-tools: Read",
        "---",
        "",
        "# Dolibarr Developer Skill",
        "## When to Use",
        "Lots of live guidance.",
      ].join("\n");
      writeFileSync(absolute, live, "utf-8");

      const result = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });

      expect(result.expected).toContain("# Dolibarr Developer Skill");
      expect(result.expected).toContain("Lots of live guidance.");
      expect(result.expected).toContain("allowed-tools:");
    } finally {
      await context.cleanup();
    }
  });

  it("scopes mcp.json diffs to the selected server", async () => {
    const context = await createInitializedTestContext("managed-file-diff-mcp-scope");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "alpha",
          description: "",
          content: "",
          metadata: { transport: "http", url: "https://example.com/alpha-expected" },
          source: "~/.cursor/mcp.json",
        }).id,
      );
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "beta",
          description: "",
          content: "",
          metadata: { transport: "http", url: "https://example.com/beta-expected" },
          source: "~/.cursor/mcp.json",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });

      const relative = ".cursor/mcp.json";
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(
        join(context.homeDir, relative),
        `${JSON.stringify(
          {
            mcpServers: {
              alpha: { url: "https://example.com/alpha-live" },
              beta: { url: "https://example.com/beta-live" },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const full = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "cursor",
      });
      expect(full.current).toContain("alpha-live");
      expect(full.current).toContain("beta-live");
      expect(full.expected).toContain("alpha-expected");
      expect(full.expected).toContain("beta-expected");

      const scoped = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "cursor",
        resource: { type: "mcp_server", name: "alpha" },
      });
      expect(scoped.current).toContain("alpha-live");
      expect(scoped.current).not.toContain("beta-live");
      expect(scoped.expected).toContain("alpha-expected");
      expect(scoped.expected).not.toContain("beta-expected");
    } finally {
      await context.cleanup();
    }
  });

  it("scopes settings.json diffs to the selected permission, not sibling hooks", async () => {
    const context = await createInitializedTestContext("managed-file-diff-permission-scope");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "permission",
          name: "allow-Bash(jk:*)",
          description: "",
          content: "",
          metadata: { action: "allow", pattern: "Bash(jk:*)" },
          source: "~/.claude/settings.json",
        }).id,
      );
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "hook",
          name: "SessionStart-1",
          description: "",
          content: "ponytail",
          metadata: { event: "SessionStart", script: "ponytail" },
          source: "~/.claude/settings.json",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const relative = ".claude/settings.json";
      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.homeDir, relative),
        `${JSON.stringify(
          {
            permissions: { allow: ["Bash(jk:*)"] },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const full = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });
      expect(full.expected).toContain("SessionStart");
      expect(full.expected).toContain("ponytail");
      expect(full.current).not.toContain("ponytail");

      const scopedPermission = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
        resource: { type: "permission", name: "allow-Bash(jk:*)" },
      });
      expect(scopedPermission.expected).toContain("Bash(jk:*)");
      expect(scopedPermission.expected).not.toContain("ponytail");
      expect(scopedPermission.expected).not.toContain("SessionStart");
      expect(scopedPermission.current).toContain("Bash(jk:*)");
      expect(scopedPermission.current).not.toContain("ponytail");
      expect(scopedPermission.expected).toBe(scopedPermission.current);

      const scopedHook = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
        resource: { type: "hook", name: "SessionStart-1" },
      });
      expect(scopedHook.expected).toContain("ponytail");
      expect(scopedHook.expected).not.toContain("Bash(jk:*)");
      expect(scopedHook.current).not.toContain("ponytail");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a live absolute subagent path onto the clicked agent file", async () => {
    const context = await createInitializedTestContext("managed-file-diff-agent-path");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "agent",
          name: "code-reviewer",
          description: "review",
          content: "Review the diff carefully.",
          metadata: {},
          source: "manual",
        }).id,
      );
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "agent",
          name: "planner",
          description: "plan",
          content: "Plan the work.",
          metadata: {},
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const reviewerRelative = ".claude/agents/code-reviewer.md";
      const plannerRelative = ".claude/agents/planner.md";
      const reviewerAbsolute = join(context.homeDir, reviewerRelative);
      const plannerAbsolute = join(context.homeDir, plannerRelative);
      mkdirSync(join(context.homeDir, ".claude", "agents"), { recursive: true });
      writeFileSync(reviewerAbsolute, "---\nname: code-reviewer\n---\n\n# live reviewer\n", "utf-8");
      writeFileSync(plannerAbsolute, "---\nname: planner\n---\n\n# live planner\n", "utf-8");

      const fromAbsolute = await getManagedFileDiff({
        profileSelector: "work",
        path: reviewerAbsolute,
        scope: "home",
        harness: "claude-code",
        resource: { type: "agent", name: "code-reviewer" },
      });
      expect(fromAbsolute.path).toBe(reviewerRelative);
      expect(fromAbsolute.current).toContain("live reviewer");
      expect(fromAbsolute.current).not.toContain("live planner");
      expect(fromAbsolute.expected).toContain("Review the diff carefully.");

      const fromSibling = await getManagedFileDiff({
        profileSelector: "work",
        path: plannerAbsolute,
        scope: "home",
        harness: "claude-code",
        resource: { type: "agent", name: "code-reviewer" },
      });
      expect(fromSibling.path).toBe(reviewerRelative);
      expect(fromSibling.current).toContain("live reviewer");
      expect(fromSibling.current).not.toContain("live planner");
      expect(fromSibling.expected).not.toContain("Plan the work.");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps the clicked harness path when the same subagent exists on another harness", async () => {
    const context = await createInitializedTestContext("managed-file-diff-harness-path");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "agent",
          name: "executor",
          description: "implement",
          content: "Implement the change.",
          metadata: {},
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code,cursor",
        conflictPolicy: "replace",
      });

      const claudeRelative = ".claude/agents/executor.md";
      const cursorRelative = ".cursor/agents/executor.md";
      mkdirSync(join(context.homeDir, ".claude", "agents"), { recursive: true });
      mkdirSync(join(context.homeDir, ".cursor", "agents"), { recursive: true });
      writeFileSync(
        join(context.homeDir, claudeRelative),
        "---\nname: executor\n---\n\nImplement the change.\n",
        "utf-8",
      );
      writeFileSync(
        join(context.homeDir, cursorRelative),
        "---\nname: executor\n---\n---\nname: executor\n---\n\nImplement the change.\n",
        "utf-8",
      );

      const result = await getManagedFileDiff({
        profileSelector: "work",
        path: cursorRelative,
        scope: "home",
        harness: "claude-code,cursor",
        resource: { type: "agent", name: "executor" },
      });
      expect(result.path).toBe(cursorRelative);
      expect(result.current).toContain("---\nname: executor\n---\n---\n");
      expect(result.expected).not.toContain("---\nname: executor\n---\n---\n");
    } finally {
      await context.cleanup();
    }
  });
});
