import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { createPlugin, addResourceToPlugin, mergePluginsById } from "../../src/models/plugin-model.ts";
import { attachPluginPinToPlugin } from "../../src/services/plugin-composition.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { createResource } from "../../src/models/resource.ts";

describe("mergePluginsById", () => {
  it("derives Claude config from plugin pins when the plugin has no claude block", async () => {
    const context = await createTestContext("plugin-merge-plugin-pins");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "foundation" });
      attachPluginPinToPlugin(plugin.id, "superpowers@obra", "5.1.0");
      attachPluginPinToPlugin(plugin.id, "context7@anthropics", "1.0.0");

      const merged = mergePluginsById([plugin.id]);

      expect(merged.resources).toHaveLength(0);
      expect(merged.claude?.plugins).toEqual([
        { id: "superpowers@claude-plugins-official", version: "5.1.0", enabled: true },
        { id: "context7@claude-plugins-official", version: "1.0.0", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps plugin resources and merges explicit claude config with pins", async () => {
    const context = await createTestContext("plugin-merge-mixed");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({
        name: "mixed",
        claude: {
          plugins: [{ id: "legacy@market", enabled: false }],
        },
      });
      attachPluginPinToPlugin(plugin.id, "superpowers@obra", "5.1.0");
      const resource = createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Hello",
        }),
      );
      addResourceToPlugin(plugin.id, resource.id);

      const merged = mergePluginsById([plugin.id]);

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
