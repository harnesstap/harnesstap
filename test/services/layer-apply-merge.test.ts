import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createLayer, addResourceToLayer } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createLayerFromSources } from "../../src/models/layer-model.ts";
import { mergeLayersForApply } from "../../src/services/layer-apply-merge.ts";

describe("layer apply merge", () => {
  it("merges source layers and default environment resources", async () => {
    const context = await createInitializedTestContext("layer-apply-merge");

    try {
      const plugin = createLayer({ name: "pagerduty" });
      addResourceToLayer(
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

      const layer = createLayerFromSources({
        name: "backend-oncall",
        sourceLayerIds: [plugin.id],
        environmentId: env.id,
      });

      const merged = mergeLayersForApply([layer.id]);
      expect(merged.resources.map((r) => r.name)).toEqual(["oncall", "PD_REGION"]);
    } finally {
      await context.cleanup();
    }
  });
});
