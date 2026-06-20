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

  it("removes orphan skill directories when re-applying the same profile", async () => {
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

      const orphanPath = join(
        context.homeDir,
        ".claude/skills/building-dbt-semantic-layer/SKILL.md",
      );
      mkdirSync(dirname(orphanPath), { recursive: true });
      writeFileSync(orphanPath, "# dbt semantic layer", "utf-8");

      const reapplied = await applyProfileLayer("default", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(existsSync(orphanPath)).toBe(false);
      expect(reapplied.removed_files).toContain(
        ".claude/skills/building-dbt-semantic-layer/SKILL.md",
      );
    } finally {
      await context.cleanup();
    }
  });
});
