import { existsSync, closeSync, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { addResourceToLayer, createLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import * as profileApply from "../../src/services/profile-apply.ts";
import {
  PROFILE_APPLY_LOCK_FILE,
  ProfileApplyLockBusyError,
} from "../../src/services/profile-apply-lock.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import {
  useProfileCommand,
  useProfileCommandUnlocked,
} from "../../src/services/profile-commands.ts";
import {
  ProfileSwitchNoBaselineError,
  SwitchRestoreFailedError,
  switchProfile,
} from "../../src/services/profile-switch.ts";

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

function createProfile(name: string, skillName: string) {
  const layer = createLayer({ name });
  setLayerTags(layer.id, ["profile"]);
  addResourceToLayer(layer.id, createSkill(skillName, `# ${skillName}`).id);
  return layer;
}

describe("profile-switch service", () => {
  it("switches profiles when a global apply baseline exists", async () => {
    const context = await createInitializedTestContext("profile-switch-happy");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");

      await profileApply.applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      const events: string[] = [];
      const result = await switchProfile("profile-b", {
        apply: {
          harness: "claude-code",
          conflictPolicy: "replace",
        },
        onStep: (event) => {
          events.push(`${event.step}:${event.status}`);
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.apply.profile_name).toBe("profile-b");
      expect(existsSync(join(context.homeDir, ".claude/skills/skill-b/SKILL.md"))).toBe(true);
      expect(events).toContain("validate_baseline:completed");
      expect(events).toContain("apply_home:completed");
      expect(events).toContain("complete:completed");
    } finally {
      await context.cleanup();
    }
  });

  it("refuses to switch when no global apply snapshot exists", async () => {
    const context = await createInitializedTestContext("profile-switch-no-baseline");
    try {
      createProfile("profile-a", "skill-a");

      await expect(
        switchProfile("profile-a", {
          apply: {
            harness: "claude-code",
            conflictPolicy: "replace",
          },
        }),
      ).rejects.toBeInstanceOf(ProfileSwitchNoBaselineError);
    } finally {
      await context.cleanup();
    }
  });

  it("restores the previous profile when the target apply fails", async () => {
    const context = await createInitializedTestContext("profile-switch-restore");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");

      await profileApply.applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      const result = await switchProfile("profile-b", {
        apply: {
          harness: "claude-code",
          conflictPolicy: "replace",
        },
        useProfile: async (selector, options) => {
          if (selector === "profile-b") {
            throw new Error("injected apply failure");
          }
          return useProfileCommandUnlocked(selector, options);
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok || result.cancelled) {
        return;
      }
      expect(result.apply_error).toContain("injected apply failure");
      expect(result.restored.profile_name).toBe("profile-a");
      expect(existsSync(join(context.homeDir, ".claude/skills/skill-a/SKILL.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("throws SwitchRestoreFailed when restore re-apply fails", async () => {
    const context = await createInitializedTestContext("profile-switch-restore-fail");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");

      await profileApply.applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      await expect(
        switchProfile("profile-b", {
          apply: {
            harness: "claude-code",
            conflictPolicy: "replace",
          },
          useProfile: async (selector, options) => {
            if (selector === "profile-b") {
              throw new Error("injected apply failure");
            }
            if (selector === "profile-a") {
              throw new Error("injected restore failure");
            }
            return useProfileCommandUnlocked(selector, options);
          },
        }),
      ).rejects.toBeInstanceOf(SwitchRestoreFailedError);
    } finally {
      await context.cleanup();
    }
  });

  it("fails fast when the profile apply lock is already held", async () => {
    const context = await createInitializedTestContext("profile-switch-mutex");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");

      await profileApply.applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      const lockPath = join(getHarnesstapDir(), PROFILE_APPLY_LOCK_FILE);
      const foreignLockFd = openSync(lockPath, "wx");
      try {
        await expect(
          switchProfile("profile-b", {
            apply: {
              harness: "claude-code",
              conflictPolicy: "replace",
            },
          }),
        ).rejects.toBeInstanceOf(ProfileApplyLockBusyError);

        await expect(
          useProfileCommand("profile-b", {
            harness: "claude-code",
            conflictPolicy: "replace",
          }),
        ).rejects.toBeInstanceOf(ProfileApplyLockBusyError);
      } finally {
        closeSync(foreignLockFd);
        unlinkSync(lockPath);
      }
    } finally {
      await context.cleanup();
    }
  });
});
