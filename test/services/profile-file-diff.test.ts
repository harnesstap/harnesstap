import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { getManagedFileDiff } from "../../src/services/profile-file-diff.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("getManagedFileDiff", () => {
  it("returns expected snapshot content and drifted live content", async () => {
    const context = await createInitializedTestContext("managed-file-diff");
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
      const drifted =
        "---\nname: manual-skill\ndescription: x\n---\n\n# drifted\n";
      writeFileSync(absolute, drifted, "utf-8");

      const result = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });

      expect(result.path).toBe(relative);
      expect(result.absolute_path).toBe(absolute);
      expect(result.expected).toContain("# original");
      expect(result.current).toBe(drifted);
    } finally {
      await context.cleanup();
    }
  });
});
