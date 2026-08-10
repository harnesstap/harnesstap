import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { CursorSerializer } from "../../src/platforms/cursor.ts";
import { getPlatform } from "../../src/platforms/registry.ts";
import {
  buildCursorHostManagedStatus,
  detectCursorHostManagedSkillCollisions,
  scanCursorHostManagedSkills,
} from "../../src/services/cursor-host-managed-skills.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { scanHomeDefaults } from "../../src/services/scanner.ts";
import { detectNotStagedProfileResources } from "../../src/services/profile-untracked-resources.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

function writeSkill(dir: string, name: string, description: string): void {
  writeTextFile(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

describe("cursor host-managed skills", () => {
  it("discovers host-managed skills and detects user collisions", async () => {
    const context = await createInitializedTestContext("cursor-host-managed-skills");
    try {
      writeSkill(
        join(context.homeDir, ".cursor", "skills-cursor"),
        "create-skill",
        "Built-in create skill",
      );
      writeSkill(
        join(context.homeDir, ".cursor", "skills-cursor"),
        "loop",
        "Built-in loop",
      );
      writeSkill(
        join(context.homeDir, ".cursor", "skills"),
        "create-skill",
        "User create skill",
      );

      const skills = scanCursorHostManagedSkills(context.homeDir);
      expect(skills.map((skill) => skill.name)).toEqual(["create-skill", "loop"]);
      expect(skills[0]?.source).toBe("~/.cursor/skills-cursor/create-skill/SKILL.md");

      const collisions = detectCursorHostManagedSkillCollisions({
        hostSkills: skills,
        homeRoot: context.homeDir,
      });
      expect(collisions).toEqual([
        {
          name: "create-skill",
          host_source: "~/.cursor/skills-cursor/create-skill/SKILL.md",
          user_source: "~/.cursor/skills/create-skill/SKILL.md",
          overlap: "user_skill",
        },
      ]);

      expect(scanCursorHostManagedSkills(join(context.homeDir, "missing"))).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("never includes skills-cursor in scanGlobal or home scan results", async () => {
    const context = await createInitializedTestContext("cursor-host-not-in-scan");
    try {
      writeSkill(
        join(context.homeDir, ".cursor", "skills-cursor"),
        "create-skill",
        "Built-in",
      );
      writeSkill(
        join(context.homeDir, ".cursor", "skills"),
        "research",
        "User research",
      );

      const serializer = new CursorSerializer();
      const globalResources = await serializer.scanGlobal(context.homeDir);
      expect(
        globalResources
          .filter((resource) => resource.type === "skill")
          .map((resource) => resource.name),
      ).toEqual(["research"]);
      expect(
        globalResources.every(
          (resource) => !resource.source.includes("skills-cursor"),
        ),
      ).toBe(true);

      const homeScan = await scanHomeDefaults("cursor", context.homeDir);
      const cursor = homeScan.find((result) => result.platformId === "cursor");
      expect(
        cursor?.resources.some((resource) =>
          resource.source.includes("skills-cursor"),
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("does not treat host-managed skills as not-staged", async () => {
    const context = await createInitializedTestContext("cursor-host-not-staged");
    try {
      const layer = createLayer({ name: "work" });
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
      await applyProfileLayer("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      writeSkill(
        join(context.homeDir, ".cursor", "skills-cursor"),
        "create-skill",
        "Built-in",
      );

      const notStaged = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
        harness: "cursor",
      });
      expect(
        notStaged.some(
          (resource) =>
            resource.name === "create-skill"
            || resource.source.includes("skills-cursor"),
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("attaches host_managed on full profile status and omits it on fast depth", async () => {
    const context = await createInitializedTestContext("cursor-host-status");
    try {
      const layer = createLayer({ name: "work" });
      setLayerTags(layer.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "create-skill",
        description: "Profile skill",
        content: "# create-skill",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, skill.id);
      await applyProfileLayer("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      writeSkill(
        join(context.homeDir, ".cursor", "skills-cursor"),
        "create-skill",
        "Built-in",
      );

      const full = await detectGlobalProfileStatus({
        harness: "cursor",
        depth: "full",
      });
      expect(full.host_managed?.cursor?.skills.map((entry) => entry.name)).toEqual([
        "create-skill",
      ]);
      expect(full.host_managed?.cursor?.collisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "create-skill",
            overlap: "profile_skill",
          }),
          expect.objectContaining({
            name: "create-skill",
            overlap: "user_skill",
          }),
        ]),
      );
      expect(full.panel.reasons).toContain("cursor_host_skill_collision");
      expect(full.has_drift).toBe(false);

      const fast = await detectGlobalProfileStatus({
        harness: "cursor",
        depth: "fast",
      });
      expect(fast.host_managed).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("registers hostManagedPaths on Cursor without putting it in globalPaths", () => {
    const platform = getPlatform("cursor");
    expect(platform?.hostManagedPaths?.skills).toBe("~/.cursor/skills-cursor/");
    expect(platform?.globalPaths.skills).toBe("~/.cursor/skills/");
  });

  it("buildCursorHostManagedStatus returns inventory and collisions together", async () => {
    const context = await createInitializedTestContext("cursor-host-build-status");
    try {
      writeSkill(
        join(context.homeDir, ".cursor", "skills-cursor"),
        "loop",
        "Built-in loop",
      );
      const status = buildCursorHostManagedStatus({
        homeRoot: context.homeDir,
        profileSkills: new Map([["loop", "manual"]]),
      });
      expect(status.skills).toHaveLength(1);
      expect(status.collisions).toEqual([
        {
          name: "loop",
          host_source: "~/.cursor/skills-cursor/loop/SKILL.md",
          user_source: "manual",
          overlap: "profile_skill",
        },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
