import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  CLEARED_GLOBAL_PROFILE_LAYER_ID,
  CLEARED_GLOBAL_PROFILE_NAME,
} from "../../src/constants/profile.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setHarnessPreference } from "../../src/models/harness.js";
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
  listProfileLayersCommand,
  renameProfileCommand,
} from "../../src/services/profile-commands.ts";
import {
  listProfileStashEntries,
  popProfileStashCommand,
  ProfileStashError,
  stashProfileCommand,
} from "../../src/services/profile-stash.ts";
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

function writeUntrackedSkill(homeDir: string, skillName: string, content: string) {
  mkdirSync(join(homeDir, ".claude", "skills", skillName), { recursive: true });
  writeFileSync(
    join(homeDir, ".claude", "skills", skillName, "SKILL.md"),
    content,
    "utf-8",
  );
}

describe("profile stash", () => {
  it("does not include a virtual empty profile in profile list", async () => {
    const context = await createInitializedTestContext("profile-stash-list");
    try {
      createProfileCommand({ name: "work" });
      const names = listProfileLayersCommand().map((layer) => layer.name);
      expect(names).not.toContain(CLEARED_GLOBAL_PROFILE_NAME);
      expect(names).toContain("work");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects create, rename-to, and delete of reserved name empty", async () => {
    const context = await createInitializedTestContext("profile-stash-guards");
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

  it("stashes only untracked resources and keeps tracked files and active profile", async () => {
    const context = await createInitializedTestContext("profile-stash-untracked");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      writeUntrackedSkill(
        context.homeDir,
        "manual-skill",
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      );

      const trackedPath = join(context.homeDir, ".claude/skills/skill-a/SKILL.md");
      const untrackedPath = join(context.homeDir, ".claude/skills/manual-skill/SKILL.md");
      expect(existsSync(trackedPath)).toBe(true);
      expect(existsSync(untrackedPath)).toBe(true);

      const result = await stashProfileCommand({
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(result.entry.profile_name).toBe("profile-a");
      expect(result.entry.contents.resources.map((resource) => resource.name)).toEqual([
        "manual-skill",
      ]);
      expect(result.cleared.profile_name).toBe("profile-a");
      expect(result.cleared.removed_files).toContain(".claude/skills/manual-skill/SKILL.md");
      expect(existsSync(trackedPath)).toBe(true);
      expect(existsSync(untrackedPath)).toBe(false);
      expect(getActiveProfileName()).toBe("profile-a");
      expect(listProfileStashEntries()).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("pops the most recent stash and restores untracked files only", async () => {
    const context = await createInitializedTestContext("profile-stash-pop");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");
      writeUntrackedSkill(
        context.homeDir,
        "manual-skill",
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      );

      await stashProfileCommand({
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const untrackedPath = join(context.homeDir, ".claude/skills/manual-skill/SKILL.md");
      expect(existsSync(untrackedPath)).toBe(false);

      const restored = await popProfileStashCommand({
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(restored.entry.profile_name).toBe("profile-a");
      expect(restored.restored.profile_name).toBe("profile-a");
      expect(restored.restored.restored_files).toContain(
        ".claude/skills/manual-skill/SKILL.md",
      );
      expect(existsSync(untrackedPath)).toBe(true);
      expect(getActiveProfileName()).toBe("profile-a");
      expect(listProfileStashEntries()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("errors when there are no untracked resources", async () => {
    const context = await createInitializedTestContext("profile-stash-no-untracked");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      await expect(
        stashProfileCommand({
          harness: "claude-code",
          conflictPolicy: "replace",
        }),
      ).rejects.toThrow("No untracked resources to stash");
    } finally {
      await context.cleanup();
    }
  });

  it("does not stash tracked resource drift as stashable state", async () => {
    const context = await createInitializedTestContext("profile-stash-tracked-drift");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");
      writeFileSync(
        join(context.homeDir, ".claude/skills/skill-a/SKILL.md"),
        "# Skill A modified",
        "utf-8",
      );

      await expect(
        stashProfileCommand({
          harness: "claude-code",
          conflictPolicy: "replace",
        }),
      ).rejects.toThrow("No untracked resources to stash");
    } finally {
      await context.cleanup();
    }
  });

  it("supports multiple untracked stash bundles", async () => {
    const context = await createInitializedTestContext("profile-stash-multi");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("skill-a", "# Skill A").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      writeUntrackedSkill(
        context.homeDir,
        "manual-one",
        "---\nname: manual-one\ndescription: one\n---\n\n# one",
      );
      await stashProfileCommand({
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      writeUntrackedSkill(
        context.homeDir,
        "manual-two",
        "---\nname: manual-two\ndescription: two\n---\n\n# two",
      );
      await stashProfileCommand({
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const entries = listProfileStashEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.contents.resources[0]?.name).toBe("manual-two");
      expect(entries[1]?.contents.resources[0]?.name).toBe("manual-one");
    } finally {
      await context.cleanup();
    }
  });

  it("errors when stashing without an active profile", async () => {
    const context = await createInitializedTestContext("profile-stash-no-active");
    try {
      await expect(
        stashProfileCommand({
          harness: "claude-code",
          conflictPolicy: "replace",
        }),
      ).rejects.toThrow(ProfileStashError);
    } finally {
      await context.cleanup();
    }
  });

  it("clears global state via project use --profile empty after optional untracked stash", async () => {
    const context = await createInitializedTestContext("profile-stash-project-use");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

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
      writeUntrackedSkill(
        context.homeDir,
        "manual-skill",
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
      );

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
      expect(result.stashed).toBe(true);
      expect(result.profile_key).toBe("profile-a");
      expect(result.profile_name).toBe(CLEARED_GLOBAL_PROFILE_NAME);
      expect(result.profile_layer_id).toBe(CLEARED_GLOBAL_PROFILE_LAYER_ID);
      expect(existsSync(skillAPath)).toBe(false);
      expect(getActiveProfileName()).toBeUndefined();
      expect(listProfileStashEntries()).toHaveLength(1);
      expect(listProfileStashEntries()[0]?.contents.resources[0]?.name).toBe(
        "manual-skill",
      );
    } finally {
      await context.cleanup();
    }
  });
});
