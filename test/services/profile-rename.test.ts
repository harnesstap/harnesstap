import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  createLayer,
  getLayerById,
  getLayerByName,
} from "../../src/models/plugin-model.ts";
import {
  createGlobalApplySnapshot,
  getLatestGlobalApplySnapshotForProfile,
} from "../../src/models/global-apply-snapshot.ts";
import { findResourceByKey } from "../../src/models/resource.ts";
import { ensureLayerResource } from "../../src/services/layer-composition.ts";
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
  it("renames a profile layer and updates active pointer + snapshots", async () => {
    const context = await createInitializedTestContext("profile-rename-active");
    try {
      const created = createProfileCommand({ name: "work" });
      setActiveProfileName("work");
      createGlobalApplySnapshot({
        profile_name: "work",
        layer_ids: [created.layer.id],
      });
      ensureLayerResource("work");

      const result = renameProfileCommand("work", "focus");

      expect(result).toEqual({
        old_name: "work",
        name: "focus",
        layer_id: created.layer.id,
        was_active: true,
      });
      expect(getLayerByName("work")).toBeUndefined();
      expect(getLayerByName("focus")?.id).toBe(created.layer.id);
      expect(getLayerById(created.layer.id)?.name).toBe("focus");
      expect(getActiveProfileName()).toBe("focus");
      expect(getLatestGlobalApplySnapshotForProfile("work")).toBeUndefined();
      expect(getLatestGlobalApplySnapshotForProfile("focus")?.layer_ids).toEqual([
        created.layer.id,
      ]);
      expect(findResourceByKey("layer", "work", "")).toBeUndefined();
      expect(findResourceByKey("layer", "focus", "")?.name).toBe("focus");
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
        expect.unreachable("expected layer_exists");
      } catch (error) {
        expect(error).toBeInstanceOf(ProfileRenameError);
        expect((error as ProfileRenameError).code).toBe("layer_exists");
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

  it("rejects non-profile layers", async () => {
    const context = await createInitializedTestContext("profile-rename-not-profile");
    try {
      createLayer({ name: "plain" });
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
