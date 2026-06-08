import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { addResourceToPlugin } from "../../src/models/plugin-component.ts";
import { createPlugin } from "../../src/models/plugin-component.ts";
import {
  ensurePluginResource,
  listAttachedPluginPins,
} from "../../src/services/composition-resource.ts";

describe("composition resources", () => {
  it("creates lazy plugin resources without syncing", async () => {
    const context = await createInitializedTestContext("composition-plugin-lazy");

    try {
      const layer = createPlugin({ name: "backend" });
      const resource = ensurePluginResource("plugin:posthog@cursor-team-kit");
      addResourceToPlugin(layer.id, resource.id);

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
