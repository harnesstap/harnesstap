import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { restoreManagedFile } from "../../src/services/profile-restore-file.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("restoreManagedFile", () => {
  it("writes expected profile content back to a modified managed path", async () => {
    const context = await createInitializedTestContext("restore-managed-file");
    try {
      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(profile.id, skill.id);
      await applyProfileLayer("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const relative = ".claude/skills/manual-skill/SKILL.md";
      const absolute = join(context.homeDir, relative);
      writeFileSync(absolute, "---\nname: manual-skill\ndescription: x\n---\n\n# drifted\n", "utf-8");

      const result = await restoreManagedFile({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });

      expect(result.path).toBe(relative);
      expect(result.absolute_path).toBe(absolute);
      expect(readFileSync(absolute, "utf-8")).toContain("# original");
      expect(readFileSync(absolute, "utf-8")).not.toContain("# drifted");
    } finally {
      await context.cleanup();
    }
  });
});
