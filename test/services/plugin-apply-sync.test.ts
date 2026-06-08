import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { findPluginResourceByPin } from "../../src/services/composition-resource.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-apply-sync.ts";
import { createLayer } from "../../src/models/layer.ts";
import { addPluginToLayer } from "../../src/models/plugin-pins.ts";

function seedFormatterPlugin(homeDir: string): void {
  mkdirSync(join(homeDir, ".claude/plugins/cache/acme-marketplace/formatter/.claude-plugin"), {
    recursive: true,
  });
  writeFileSync(
    join(homeDir, ".claude/plugins/cache/acme-marketplace/formatter/.claude-plugin/plugin.json"),
    JSON.stringify({
      name: "formatter",
      version: "1.9.0",
      description: "Formatter plugin test stub",
    }),
    "utf-8",
  );
}

describe("syncPluginPinsForApply", () => {
  it("resolves plugin versions from local install trees before apply", async () => {
    const context = await createTestContext("plugin-apply-sync");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      seedFormatterPlugin(context.homeDir);
      const layer = createLayer({ name: "sync-me" });
      addPluginToLayer(layer.id, "formatter@acme-marketplace", "1.9.0");

      const plugin = findPluginResourceByPin("formatter@acme-marketplace", "1.9.0");
      expect(plugin).toBeDefined();
      expect((plugin?.metadata as { resolved_version?: string }).resolved_version).toBeUndefined();

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.9.0" }],
        homeRoot: context.homeDir,
      });

      const synced = findPluginResourceByPin("formatter@acme-marketplace", "1.9.0");
      expect((synced?.metadata as { resolved_version?: string }).resolved_version).toBe("1.9.0");
    } finally {
      await context.cleanup();
    }
  });
});
