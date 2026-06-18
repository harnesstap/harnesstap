import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { listGlobalApplySnapshots } from "../../src/models/global-apply-snapshot.ts";

describe("profile-apply service", () => {
  it("supports dry-run global apply for profile layers", async () => {
    const context = await createInitializedTestContext("profile-apply-dry-run");
    try {
      const layer = createLayer({
        name: "work",
      });
      setLayerTags(layer.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# profile guide",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);

      const result = await applyProfileLayer("work", {
        dryRun: true,
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      expect(result.dry_run).toBe(true);
      expect(result.profile_name).toBe("work");
      expect(result.files.some((file) => file.includes("CLAUDE.md"))).toBe(true);
      expect(existsSync(join(context.homeDir, "CLAUDE.md"))).toBe(false);
      expect(listGlobalApplySnapshots()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });
});
