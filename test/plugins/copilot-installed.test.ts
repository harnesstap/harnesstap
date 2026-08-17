import { describe, expect, it } from "bun:test";
import { listInstalledCopilotPluginPinCreateInputs } from "../../src/plugins/copilot-installed.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { join } from "node:path";

describe("listInstalledCopilotPluginPinCreateInputs", () => {
  it("imports plugin pins from ~/.copilot/installed-plugins", () => {
    const homeRoot = createTempDir("copilot-installed-pins");

    try {
      writeTextFile(
        join(
          homeRoot,
          ".copilot/installed-plugins/claude-code-skills/business-growth-skills/.claude-plugin/plugin.json",
        ),
        JSON.stringify({
          name: "business-growth-skills",
          version: "1.0.0",
          description: "Business and growth skills",
        }),
      );
      writeTextFile(
        join(
          homeRoot,
          ".copilot/installed-plugins/superpowers-marketplace/superpowers/.github/plugin/plugin.json",
        ),
        JSON.stringify({
          name: "superpowers",
          version: "4.0.0",
        }),
      );

      const pins = listInstalledCopilotPluginPinCreateInputs(homeRoot);

      expect(pins.map((pin) => pin.origin_ref)).toEqual([
        "business-growth-skills@claude-code-skills",
        "superpowers@superpowers-marketplace",
      ]);

      const growth = pins.find(
        (pin) => pin.origin_ref === "business-growth-skills@claude-code-skills",
      );
      expect(growth).toMatchObject({
        type: "plugin",
        name: "business-growth-skills",
        namespace: "claude-code-skills",
        origin_kind: "marketplace_link",
        source: "~/.copilot/installed-plugins/",
      });
      expect(growth?.metadata).toMatchObject({
        source_kind: "marketplace",
        marketplace_name: "claude-code-skills",
        resolved_version: "1.0.0",
        sync_status: "never_synced",
        portable: "reference",
      });
    } finally {
      cleanupDir(homeRoot);
    }
  });
});
