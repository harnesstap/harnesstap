import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPlugin, getPlugin } from "../../src/models/plugin-component.ts";

describe("plugin component model", () => {
  it("creates a plugin with claude config", async () => {
    const context = await createInitializedTestContext("plugin-component-needs");

    try {
      const plugin = createPlugin({
        name: "pagerduty",
        version: "1.0.0",
        claude: { plugins: [{ id: "pd@marketplace" }] },
        needs: ["PD_TOKEN", "PD_REGION"],
      });
      expect(getPlugin(plugin.id)?.needs).toEqual(["PD_TOKEN", "PD_REGION"]);
    } finally {
      await context.cleanup();
    }
  });
});
