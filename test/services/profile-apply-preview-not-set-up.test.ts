import { describe, expect, it } from "bun:test";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("previewProfileApply not_set_up", () => {
  it("flags a preview when no harness is registered", async () => {
    const context = await createInitializedTestContext("preview-not-set-up");
    try {
      setHarnessPreference({ registered_harnesses: [] });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const preview = await previewProfileApply({ profile: "work", scope: "home" });
      expect(preview.not_set_up).toBe(true);

      const explicit = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(explicit.not_set_up).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("does not flag a preview once a harness is registered", async () => {
    const context = await createInitializedTestContext("preview-set-up");
    try {
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const preview = await previewProfileApply({ profile: "work", scope: "home" });
      expect(preview.not_set_up).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
