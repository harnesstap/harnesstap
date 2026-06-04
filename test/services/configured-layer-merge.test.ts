import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createPlugin, addResourceToPlugin } from "../../src/models/plugin-component.ts";
import { createResource } from "../../src/models/resource.ts";
import { createConfiguredLayer } from "../../src/models/configured-layer.ts";
import { mergeConfiguredLayers } from "../../src/services/configured-layer-merge.ts";

describe("configured layer merge", () => {
  it("merges plugins and default environment resources from configured layers", async () => {
    const context = await createInitializedTestContext("configured-layer-merge");

    try {
      const plugin = createPlugin({ name: "pagerduty" });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "oncall",
          description: "",
          content: "# Oncall",
          metadata: {},
          source: "manual",
        }).id,
      );

      const env = createEnvironment({ name: "prod" });
      addResourceToEnvironment(
        env.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "eu" },
          source: "manual",
        }),
      );

      const layer = createConfiguredLayer({
        name: "backend-oncall",
        pluginIds: [plugin.id],
        environmentId: env.id,
      });

      const merged = mergeConfiguredLayers([layer.id]);
      expect(merged.resources.map((r) => r.name)).toEqual(["oncall", "PD_REGION"]);
    } finally {
      await context.cleanup();
    }
  });
});
