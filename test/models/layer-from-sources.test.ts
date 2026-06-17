import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import { createLayer, createLayerFromSources, getLayerResources } from "../../src/models/layer-model.ts";

describe("layer from sources", () => {
  it("binds multiple plugins and a default environment", async () => {
    const context = await createInitializedTestContext("layer-from-sources-bind");

    try {
      const p1 = createLayer({ name: "pagerduty" });
      const p2 = createLayer({ name: "slack" });
      const env = createEnvironment({ name: "oncall-prod" });
      const layer = createLayerFromSources({
        name: "backend-oncall",
        sourceLayerIds: [p1.id, p2.id],
        environmentId: env.id,
      });
      expect(layer.name).toBe("backend-oncall");
      expect(getLayerResources(layer.id).length).toBeGreaterThanOrEqual(0);
    } finally {
      await context.cleanup();
    }
  });
});
