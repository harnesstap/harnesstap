import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  createPlugin,
  getPluginById,
  getPluginByName,
} from "../../src/models/plugin-model.ts";
import {
  createGlobalApplySnapshot,
  getLatestGlobalApplySnapshotForProfile,
} from "../../src/models/global-apply-snapshot.ts";
import { findResourceByKey } from "../../src/models/resource.ts";
import { ensurePluginResource } from "../../src/services/plugin-composition.ts";
import {
  ProfileRenameError,
  createProfileCommand,
  renameProfileCommand,
} from "../../src/services/profile-commands.ts";
import {
  getActiveProfileName,
  setActiveProfileName,
} from "../../src/services/active-profile.ts";

describe("renameProfileCommand", () => {
  it("renames a profile plugin and updates active pointer + snapshots", async () => {
    const context = await createInitializedTestContext("profile-rename-active");
    try {
      const created = createProfileCommand({ name: "work" });
      setActiveProfileName("work");
      createGlobalApplySnapshot({
        profile_name: "work",
        plugin_ids: [created.plugin.id],
      });
      ensurePluginResource("work");

      const result = renameProfileCommand("work", "focus");

      expect(result).toEqual({
        old_name: "work",
        name: "focus",
        plugin_id: created.plugin.id,
        was_active: true,
      });
      expect(getPluginByName("work")).toBeUndefined();
      expect(getPluginByName("focus")?.id).toBe(created.plugin.id);
      expect(getPluginById(created.plugin.id)?.name).toBe("focus");
      expect(getActiveProfileName()).toBe("focus");
      expect(getLatestGlobalApplySnapshotForProfile("work")).toBeUndefined();
      expect(getLatestGlobalApplySnapshotForProfile("focus")?.plugin_ids).toEqual([
        created.plugin.id,
      ]);
      expect(findResourceByKey("plugin", "work", "")).toBeUndefined();
      expect(findResourceByKey("plugin", "focus", "")?.name).toBe("focus");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects empty names and collisions", async () => {
    const context = await createInitializedTestContext("profile-rename-collision");
    try {
      createProfileCommand({ name: "alpha" });
      createProfileCommand({ name: "beta" });

      expect(() => renameProfileCommand("alpha", "   ")).toThrow(ProfileRenameError);
      try {
        renameProfileCommand("alpha", "beta");
        expect.unreachable("expected plugin_exists");
      } catch (error) {
        expect(error).toBeInstanceOf(ProfileRenameError);
        expect((error as ProfileRenameError).code).toBe("plugin_exists");
      }
      try {
        renameProfileCommand("alpha", "empty");
        expect.unreachable("expected reserved_name");
      } catch (error) {
        expect(error).toBeInstanceOf(ProfileRenameError);
        expect((error as ProfileRenameError).code).toBe("reserved_name");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("rejects non-profile plugins", async () => {
    const context = await createInitializedTestContext("profile-rename-not-profile");
    try {
      createPlugin({ name: "plain" });
      try {
        renameProfileCommand("plain", "renamed");
        expect.unreachable("expected not_a_profile");
      } catch (error) {
        expect(error).toBeInstanceOf(ProfileRenameError);
        expect((error as ProfileRenameError).code).toBe("not_a_profile");
      }
    } finally {
      await context.cleanup();
    }
  });
});
