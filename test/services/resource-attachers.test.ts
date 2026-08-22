import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addDependencyToPlugin,
  addResourceToPlugin,
  createPlugin,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { resourceAttacherPayload } from "../../src/services/resource-attachers.ts";

describe("resourceAttacherPayload", () => {
  it("splits direct attachers into profiles and plugins", async () => {
    const ctx = await createInitializedTestContext("resource-attachers-split");
    try {
      const skill = createResource({
        type: "skill",
        name: "ship",
        description: "Ship",
        content: "# ship",
        metadata: {},
        source: "manual",
      });
      const profile = createPlugin({ name: "work", tags: ["profile"] });
      const plugin = createPlugin({ name: "formatter", tags: [] });
      addResourceToPlugin(profile.id, skill.id);
      addResourceToPlugin(plugin.id, skill.id);
      setActiveProfileName("work");

      expect(resourceAttacherPayload(skill.id)).toEqual({
        attached_profiles: ["work"],
        attached_plugins: ["formatter"],
        active_profile: "work",
        in_active_profile: true,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it("marks in_active_profile when a nested plugin on the active stack attaches it", async () => {
    const ctx = await createInitializedTestContext("resource-attachers-nested");
    try {
      const skill = createResource({
        type: "skill",
        name: "nested-ship",
        description: "Ship",
        content: "# ship",
        metadata: {},
        source: "manual",
      });
      const nested = createPlugin({ name: "shared", tags: [] });
      const profile = createPlugin({ name: "work", tags: ["profile"] });
      addResourceToPlugin(nested.id, skill.id);
      addDependencyToPlugin(profile.id, "shared", "*");
      setActiveProfileName("work");

      const payload = resourceAttacherPayload(skill.id);
      expect(payload.attached_profiles).toEqual([]);
      expect(payload.attached_plugins).toEqual(["shared"]);
      expect(payload.in_active_profile).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it("is not in the active profile when only another profile attaches it", async () => {
    const ctx = await createInitializedTestContext("resource-attachers-other");
    try {
      const skill = createResource({
        type: "skill",
        name: "other-ship",
        description: "Ship",
        content: "# ship",
        metadata: {},
        source: "manual",
      });
      const profile = createPlugin({ name: "other", tags: ["profile"] });
      addResourceToPlugin(profile.id, skill.id);
      setActiveProfileName("work");

      expect(resourceAttacherPayload(skill.id).in_active_profile).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });
});
