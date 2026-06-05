import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import { createPlugin } from "../../src/models/plugin-component.ts";
import {
  createConfiguredLayer,
  listConfiguredLayerPlugins,
} from "../../src/models/configured-layer.ts";

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
      expect(listConfiguredLayerPlugins(layer.id)).toHaveLength(2);
    } finally {
      await context.cleanup();
    }
  });
});
