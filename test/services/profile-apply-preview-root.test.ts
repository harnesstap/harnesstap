import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("previewProfileApply files.root_path + resource", () => {
  it("includes root_path and maps modified skill paths to resource keys", async () => {
    const context = await createInitializedTestContext("preview-root-path");
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

      const skillPath = join(
        context.homeDir,
        ".claude/skills/manual-skill/SKILL.md",
      );
      writeFileSync(skillPath, "---\nname: manual-skill\ndescription: x\n---\n\n# drifted\n", "utf-8");

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code",
      });

      expect(preview.files.root_path).toBe(context.homeDir);
      const change = preview.files.changes.find((c) =>
        c.path.endsWith(".claude/skills/manual-skill/SKILL.md")
        || c.path === ".claude/skills/manual-skill/SKILL.md",
      );
      expect(change?.type).toBe("modified");
      expect(change?.resource).toEqual({ type: "skill", name: "manual-skill" });
    } finally {
      await context.cleanup();
    }
  });
});
