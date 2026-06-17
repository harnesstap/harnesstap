import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer } from "../../src/models/layer-model.ts";
import { attachPluginPinToLayer } from "../../src/services/layer-composition.ts";
import { mergePlugins } from "../../src/services/layer-merge.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { createResource } from "../../src/models/resource.ts";

describe("mergePlugins", () => {
  it("derives Claude config from plugin pins when the layer has no claude block", async () => {
    const context = await createTestContext("layer-merge-plugin-pins");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "foundation" });
      attachPluginPinToLayer(layer.id, "superpowers@obra", "5.1.0");
      attachPluginPinToLayer(layer.id, "context7@anthropics", "1.0.0");

      const merged = mergePlugins([layer.id]);

      expect(merged.resources).toHaveLength(0);
      expect(merged.claude?.plugins).toEqual([
        { id: "superpowers@claude-plugins-official", version: "5.1.0", enabled: true },
        { id: "context7@claude-plugins-official", version: "1.0.0", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps layer resources and merges explicit claude config with pins", async () => {
    const context = await createTestContext("layer-merge-mixed");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({
        name: "mixed",
        claude: {
          plugins: [{ id: "legacy@market", enabled: false }],
        },
      });
      attachPluginPinToLayer(layer.id, "superpowers@obra", "5.1.0");
      const resource = createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Hello",
        }),
      );
      addResourceToLayer(layer.id, resource.id);

      const merged = mergePlugins([layer.id]);

      expect(merged.resources).toHaveLength(1);
      expect(merged.claude?.plugins).toEqual([
        { id: "legacy@market", enabled: false },
        { id: "superpowers@claude-plugins-official", version: "5.1.0", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
