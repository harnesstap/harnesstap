import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  EMPTY_PROFILE_LAYER_ID,
  EMPTY_PROFILE_NAME,
} from "../../src/constants/profile.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { listGlobalApplySnapshots } from "../../src/models/global-apply-snapshot.ts";
import {
  getActiveProfileName,
  setActiveProfileName,
} from "../../src/services/active-profile.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import {
  ProfileRenameError,
  ProfileReservedNameError,
  createProfileCommand,
  deleteProfileCommand,
  getActiveProfilePayload,
  listProfileLayersCommand,
  renameProfileCommand,
  useProfileCommand,
} from "../../src/services/profile-commands.ts";
import { executeProjectUse } from "../../src/services/project-config-use.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

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

describe("builtin empty profile", () => {
  it("is always included in profile list", async () => {
    const context = await createInitializedTestContext("empty-profile-list");
    try {
      createProfileCommand({ name: "work" });
      const names = listProfileLayersCommand().map((layer) => layer.name);
      expect(names[0]).toBe(EMPTY_PROFILE_NAME);
      expect(names).toContain("work");
      expect(names.filter((name) => name === EMPTY_PROFILE_NAME)).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects create, rename-to, and delete of empty", async () => {
    const context = await createInitializedTestContext("empty-profile-guards");
    try {
      expect(() => createProfileCommand({ name: "empty" })).toThrow(
        ProfileReservedNameError,
      );

      createProfileCommand({ name: "work" });
      try {
        renameProfileCommand("work", "empty");
        expect.unreachable("expected reserved_name");
      } catch (error) {
        expect(error).toBeInstanceOf(ProfileRenameError);
        expect((error as ProfileRenameError).code).toBe("reserved_name");
      }

      expect(() => deleteProfileCommand("empty")).toThrow(ProfileReservedNameError);
    } finally {
      await context.cleanup();
    }
  });

  it("clears previously applied tracked files and sets active profile", async () => {
    const context = await createInitializedTestContext("empty-profile-apply");
    try {
      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");
      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      expect(existsSync(skillAPath)).toBe(true);

      const result = await useProfileCommand("empty", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(result.profile_name).toBe(EMPTY_PROFILE_NAME);
      expect(result.profile_layer_id).toBe(EMPTY_PROFILE_LAYER_ID);
      expect(result.files).toEqual([]);
      expect(result.removed_files).toContain(".claude/skills/skill-a/SKILL.md");
      expect(existsSync(skillAPath)).toBe(false);
      expect(getActiveProfileName()).toBe(EMPTY_PROFILE_NAME);
      expect(getActiveProfilePayload()).toEqual({
        active_profile: EMPTY_PROFILE_NAME,
        layer_id: EMPTY_PROFILE_LAYER_ID,
        exists: true,
      });
      expect(
        listGlobalApplySnapshots().some(
          (snapshot) => snapshot.profile_name === EMPTY_PROFILE_NAME,
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("applies via project use without a config.toml profile entry", async () => {
    const context = await createInitializedTestContext("empty-profile-project-use");
    try {
      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");
      const skillAPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      expect(existsSync(skillAPath)).toBe(true);

      const result = await executeProjectUse({
        profile: "empty",
        project: context.projectDir,
        noInteractive: true,
        format: "json",
        onConflict: "replace",
        harness: "claude-code",
        pull: false,
        force: true,
      });

      expect(result.skipped).toBe(false);
      if (result.skipped) {
        return;
      }
      expect(result.profile_key).toBe(EMPTY_PROFILE_NAME);
      expect(result.layer_name).toBe(EMPTY_PROFILE_NAME);
      expect(existsSync(skillAPath)).toBe(false);
      expect(getActiveProfileName()).toBe(EMPTY_PROFILE_NAME);
    } finally {
      await context.cleanup();
    }
  });
});
