import { describe, expect, it } from "bun:test";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import {
  clearUnicodeScanCache,
  readUnicodeScanComputeCount,
} from "../../src/services/unicode-scan.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("deployed unicode gate", () => {
  it("scans unicode only in files a dry-run would write", async () => {
    const context = await createInitializedTestContext("deployed-unicode");
    try {
      clearUnicodeScanCache();
      const plugin = createPlugin({ name: "unicode-profile" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "guide",
          description: "",
          content: "# guide\u200B\n",
          metadata: {},
          source: "manual",
        }).id,
      );
      setActiveProfileName("unicode-profile");

      const coldBefore = readUnicodeScanComputeCount();
      await applyProfilePlugin("unicode-profile", {
        dryRun: true,
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      expect(readUnicodeScanComputeCount()).toBeGreaterThan(coldBefore);

      await applyProfilePlugin("unicode-profile", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      clearUnicodeScanCache();
      const appliedBefore = readUnicodeScanComputeCount();
      await applyProfilePlugin("unicode-profile", {
        dryRun: true,
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      expect(readUnicodeScanComputeCount()).toBe(appliedBefore);
    } finally {
      await context.cleanup();
    }
  });
});
