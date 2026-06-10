import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import { createPlugin } from "../../src/models/plugin-component.ts";
import { createConfiguredLayer } from "../../src/models/configured-layer.ts";
import { getLayerResources } from "../../src/models/layer-model.ts";

describe("configured layer model", () => {
  it("binds multiple plugins and a default environment", async () => {
    const context = await createInitializedTestContext("configured-layer-bind");

    try {
      const p1 = createPlugin({ name: "pagerduty" });
      const p2 = createPlugin({ name: "slack" });
      const env = createEnvironment({ name: "oncall-prod" });
      const layer = createConfiguredLayer({
        name: "backend-oncall",
        pluginIds: [p1.id, p2.id],
        environmentId: env.id,
      });
      expect(layer.name).toBe("backend-oncall");
      expect(getLayerResources(layer.id).length).toBeGreaterThanOrEqual(0);
    } finally {
      await context.cleanup();
    }
  });
});
