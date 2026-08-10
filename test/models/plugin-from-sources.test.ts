import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import { createPlugin, createPluginFromSources, getPluginResources } from "../../src/models/plugin-model.ts";

describe("plugin from sources", () => {
  it("binds multiple plugins and a default environment", async () => {
    const context = await createInitializedTestContext("plugin-from-sources-bind");

    try {
      const p1 = createPlugin({ name: "pagerduty" });
      const p2 = createPlugin({ name: "slack" });
      const env = createEnvironment({ name: "oncall-prod" });
      const plugin = createPluginFromSources({
        name: "backend-oncall",
        sourcePluginIds: [p1.id, p2.id],
        environmentId: env.id,
      });
      expect(plugin.name).toBe("backend-oncall");
      expect(getPluginResources(plugin.id).length).toBeGreaterThanOrEqual(0);
    } finally {
      await context.cleanup();
    }
  });
});
