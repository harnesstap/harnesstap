import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";

describe("global-profile-drift service", () => {
  it("reports pending apply when active profile was never applied globally", async () => {
    const context = await createInitializedTestContext("global-profile-drift-pending");
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
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });

      expect(status.active_profile).toBe("work");
      expect(status.applied).toBe(false);
      expect(status.has_drift).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("reports in sync after profile use", async () => {
    const context = await createInitializedTestContext("global-profile-drift-synced");
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
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });

      expect(status.applied).toBe(true);
      expect(status.stack_in_sync).toBe(true);
      expect(status.has_drift).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
