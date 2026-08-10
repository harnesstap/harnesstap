import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createPlugin, addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createPluginFromSources } from "../../src/models/plugin-model.ts";
import { mergePluginsForApply } from "../../src/services/plugin-apply-merge.ts";

describe("plugin apply merge", () => {
  it("merges source plugins and default environment resources", async () => {
    const context = await createInitializedTestContext("plugin-apply-merge");

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

      const plugin = createPluginFromSources({
        name: "backend-oncall",
        sourcePluginIds: [plugin.id],
        environmentId: env.id,
      });

      const merged = mergePluginsForApply([plugin.id]);
      expect(merged.resources.map((r) => r.name)).toEqual(["oncall", "PD_REGION"]);
    } finally {
      await context.cleanup();
    }
  });
});
