import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, mock } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { listGlobalApplySnapshots } from "../../src/models/global-apply-snapshot.ts";

function createSkill(name: string, content: string) {
  return createResource({
    type: "skill",
    name,
    description: `${name} skill`,
    content,
    metadata: {},
    source: "manual",
  });
}

describe("profile-apply service", () => {
  it("supports dry-run global apply for profile plugins", async () => {
    const context = await createInitializedTestContext("profile-apply-dry-run");
    try {
      const plugin = createPlugin({
        name: "work",
      });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      const result = await applyProfilePlugin("work", {
        dryRun: true,
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(result.dry_run).toBe(true);
      expect(result.profile_name).toBe("work");
      expect(result.files.some((file) => file.includes("CLAUDE.md"))).toBe(true);
      expect(existsSync(join(context.homeDir, "CLAUDE.md"))).toBe(false);
      expect(listGlobalApplySnapshots()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("removes tracked files from the previous profile when switching profiles", async () => {
    const context = await createInitializedTestContext("profile-apply-switch-cleanup");
    try {
      const profileA = createPlugin({ name: "profile-a" });
      setPluginTags(profileA.id, ["profile"]);
      addResourceToPlugin(profileA.id, createSkill("skill-a", "# Skill A").id);

      const profileB = createPlugin({ name: "profile-b" });
      setPluginTags(profileB.id, ["profile"]);
      addResourceToPlugin(profileB.id, createSkill("skill-b", "# Skill B").id);

      await applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");
      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      expect(existsSync(skillAPath)).toBe(true);

      const switched = await applyProfilePlugin("profile-b", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      const skillBPath = join(context.homeDir, ".claude/skills/skill-b/SKILL.md");

      expect(existsSync(skillAPath)).toBe(false);
      expect(existsSync(skillBPath)).toBe(true);
      expect(switched.removed_files).toContain(".claude/skills/skill-a/SKILL.md");
    } finally {
      await context.cleanup();
    }
  });

  it("cleans up files from the active profile even when a newer snapshot belongs to another profile", async () => {
    const context = await createInitializedTestContext("profile-apply-active-profile-cleanup");
    try {
      const profileA = createPlugin({ name: "profile-a" });
      setPluginTags(profileA.id, ["profile"]);
      addResourceToPlugin(profileA.id, createSkill("skill-a", "# Skill A").id);

      const profileB = createPlugin({ name: "profile-b" });
      setPluginTags(profileB.id, ["profile"]);
      addResourceToPlugin(profileB.id, createSkill("skill-b", "# Skill B").id);

      const profileC = createPlugin({ name: "profile-c" });
      setPluginTags(profileC.id, ["profile"]);
      addResourceToPlugin(profileC.id, createSkill("skill-c", "# Skill C").id);

      await applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      await applyProfilePlugin("profile-b", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-b");

      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      const skillBPath = join(context.homeDir, ".claude/skills/skill-b/SKILL.md");
      mkdirSync(join(context.homeDir, ".claude/skills/skill-a"), { recursive: true });
      writeFileSync(skillAPath, "# Skill A", "utf-8");

      const switched = await applyProfilePlugin("profile-c", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      const skillCPath = join(context.homeDir, ".claude/skills/skill-c/SKILL.md");

      expect(existsSync(skillBPath)).toBe(false);
      expect(existsSync(skillAPath)).toBe(false);
      expect(existsSync(skillCPath)).toBe(true);
      expect(switched.removed_files).toContain(".claude/skills/skill-b/SKILL.md");
      expect(switched.removed_files).toContain(".claude/skills/skill-a/SKILL.md");
    } finally {
      await context.cleanup();
    }
  });

  it("removes files from the latest other profile snapshot when the active pointer already matches", async () => {
    const context = await createInitializedTestContext("profile-apply-latest-other-snapshot");
    try {
      const profileA = createPlugin({ name: "profile-a" });
      setPluginTags(profileA.id, ["profile"]);
      addResourceToPlugin(profileA.id, createSkill("shared-skill", "# Shared").id);
      addResourceToPlugin(profileA.id, createSkill("skill-a-only", "# A only").id);

      const profileB = createPlugin({ name: "profile-b" });
      setPluginTags(profileB.id, ["profile"]);
      addResourceToPlugin(profileB.id, createSkill("shared-skill", "# Shared").id);

      await applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-b");

      const skillAOnlyPath = join(
        context.homeDir,
        ".claude/skills/skill-a-only/SKILL.md",
      );
      expect(existsSync(skillAOnlyPath)).toBe(true);

      const applied = await applyProfilePlugin("profile-b", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(existsSync(skillAOnlyPath)).toBe(false);
      expect(applied.removed_files).toContain(".claude/skills/skill-a-only/SKILL.md");
    } finally {
      await context.cleanup();
    }
  });

  it("does not prompt to replace files that already match on profile re-apply", async () => {
    const context = await createInitializedTestContext("profile-apply-identical-reapply");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(profile.id, createSkill("shared-skill", "# Shared").id);

      const resolver = mock(async () => "replace" as const);
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "prompt",
        conflictResolver: resolver,
      });
      setActiveProfileName("work");

      resolver.mockClear();

      const reapplied = await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "prompt",
        conflictResolver: resolver,
      });

      expect(reapplied.cancelled).toBe(false);
      expect(resolver).not.toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });
});
