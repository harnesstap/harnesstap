import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setHarnessPreference } from "../../src/models/harness.js";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import {
  detectProfileHarnessSyncStatus,
} from "../../src/services/profile-harness-sync.ts";
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

describe("profile-harness-sync service", () => {
  it("detects harness resources missing from the active profile stack", async () => {
    const context = await createInitializedTestContext("profile-harness-sync-detect");
    try {
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(profile.id, createSkill("kept-skill", "# kept").id);

      await applyProfilePlugin("work", {
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
});
