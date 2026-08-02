import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.js";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { collectOrphanSkillFilesOnDisk } from "../../src/services/global-profile-cleanup.ts";

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
      expect(switched.removed_files ?? []).not.toContain(
        ".claude/skills/skill-b/SKILL.md",
      );
    } finally {
      await context.cleanup();
    }
  });
});
