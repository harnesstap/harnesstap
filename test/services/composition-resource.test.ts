import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { addResourceToLayer } from "../../src/models/plugin-model.ts";
import { createLayer } from "../../src/models/plugin-model.ts";
import {
  ensurePluginResource,
  listAttachedPluginPins,
} from "../../src/services/layer-composition.ts";

describe("composition resources", () => {
  it("creates lazy plugin resources without syncing", async () => {
    const context = await createInitializedTestContext("composition-plugin-lazy");

    try {
      const layer = createLayer({ name: "backend" });
      const resource = ensurePluginResource("plugin_pin:posthog@cursor-team-kit");
      addResourceToLayer(layer.id, resource.id);

      const pins = listAttachedPluginPins(layer.id);
      expect(pins).toHaveLength(1);
      expect(pins[0]?.ref).toBe("posthog@cursor-team-kit");
      expect(pins[0]?.resource.metadata).toMatchObject({
        sync_status: "never_synced",
      });
    } finally {
      await context.cleanup();
    }
  });
});
