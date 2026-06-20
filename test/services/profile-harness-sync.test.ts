import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setHarnessPreference } from "../../src/models/harness.js";
import { setActiveProfileName } from "../../src/services/active-profile.js";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import {
  detectProfileHarnessSyncStatus,
  updateProfileFromMainHarness,
} from "../../src/services/profile-harness-sync.ts";

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

describe("profile-harness-sync service", () => {
  it("detects harness resources missing from the active profile stack", async () => {
    const context = await createInitializedTestContext("profile-harness-sync-detect");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
      addResourceToLayer(profile.id, createSkill("kept-skill", "# kept").id);

      await applyProfileLayer("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      mkdirSync(join(context.homeDir, ".claude", "skills", "manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "manual-skill", "SKILL.md"),
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const status = await detectProfileHarnessSyncStatus({
        profileSelector: "work",
        harness: "claude-code",
      });

      expect(status.in_sync).toBe(false);
      expect(status.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource_name: "manual-skill",
            change: "added",
          }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("updates the profile layer from the main harness before switching away", async () => {
    const context = await createInitializedTestContext("profile-harness-sync-update");
    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(profileA.id, createSkill("kept-skill", "# kept").id);

      const profileB = createLayer({ name: "profile-b" });
      setLayerTags(profileB.id, ["profile"]);
      addResourceToLayer(profileB.id, createSkill("other-skill", "# other").id);

      await applyProfileLayer("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      mkdirSync(join(context.homeDir, ".claude", "skills", "manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "manual-skill", "SKILL.md"),
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const updated = await updateProfileFromMainHarness({
        profileSelector: "profile-a",
        harness: "claude-code",
      });

      expect(updated.attached_resources).toBeGreaterThanOrEqual(1);

      const synced = await detectProfileHarnessSyncStatus({
        profileSelector: "profile-a",
        harness: "claude-code",
      });
      expect(synced.in_sync).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
