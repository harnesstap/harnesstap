import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, mock } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
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
  it("supports dry-run global apply for profile layers", async () => {
    const context = await createInitializedTestContext("profile-apply-dry-run");
    try {
      const layer = createLayer({
        name: "work",
      });
      setLayerTags(layer.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);

      const result = await applyProfileLayer("work", {
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
      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      const profileB = createLayer({ name: "profile-b" });
      setLayerTags(profileB.id, ["profile"]);
      addResourceToLayer(profileB.id, createSkill("skill-b", "# Skill B").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");
      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      expect(existsSync(skillAPath)).toBe(true);

      const switched = await applyProfileLayer("profile-b", {
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
      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      const profileB = createLayer({ name: "profile-b" });
      setLayerTags(profileB.id, ["profile"]);
      addResourceToLayer(profileB.id, createSkill("skill-b", "# Skill B").id);

      const profileC = createLayer({ name: "profile-c" });
      setLayerTags(profileC.id, ["profile"]);
      addResourceToLayer(profileC.id, createSkill("skill-c", "# Skill C").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      await applyProfileLayer("profile-b", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-b");

      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      const skillBPath = join(context.homeDir, ".claude/skills/skill-b/SKILL.md");
      mkdirSync(join(context.homeDir, ".claude/skills/skill-a"), { recursive: true });
      writeFileSync(skillAPath, "# Skill A", "utf-8");

      const switched = await applyProfileLayer("profile-c", {
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
      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("shared-skill", "# Shared").id);
      addResourceToLayer(profileA.id, createSkill("skill-a-only", "# A only").id);

      const profileB = createLayer({ name: "profile-b" });
      setLayerTags(profileB.id, ["profile"]);
      addResourceToLayer(profileB.id, createSkill("shared-skill", "# Shared").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-b");

      const skillAOnlyPath = join(
        context.homeDir,
        ".claude/skills/skill-a-only/SKILL.md",
      );
      expect(existsSync(skillAOnlyPath)).toBe(true);

      const applied = await applyProfileLayer("profile-b", {
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
      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
      addResourceToLayer(profile.id, createSkill("shared-skill", "# Shared").id);

      const resolver = mock(async () => "replace" as const);
      await applyProfileLayer("work", {
        harness: "claude-code",
        conflictPolicy: "prompt",
        conflictResolver: resolver,
      });
      setActiveProfileName("work");

      resolver.mockClear();

      const reapplied = await applyProfileLayer("work", {
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
