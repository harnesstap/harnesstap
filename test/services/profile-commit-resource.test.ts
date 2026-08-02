import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource, getResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import {
  commitManagedResourceFromLive,
  resourceKeyFromManagedPath,
} from "../../src/services/profile-commit-resource.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("profile-commit-resource", () => {
  it("maps skill paths to resource keys", () => {
    expect(
      resourceKeyFromManagedPath(".claude/skills/manual-skill/SKILL.md"),
    ).toEqual({ type: "skill", name: "manual-skill" });
    expect(
      resourceKeyFromManagedPath("~/.claude/skills/manual-skill/SKILL.md"),
    ).toEqual({ type: "skill", name: "manual-skill" });
  });

  it("commits modified managed skill content from live disk into the library", async () => {
    const context = await createInitializedTestContext("profile-commit-managed");
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
      mkdirSync(join(context.homeDir, ".claude/skills/manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        skillPath,
        "---\nname: manual-skill\ndescription: updated\n---\n\n# updated live",
        "utf-8",
      );

      const committed = await commitManagedResourceFromLive({
        profileSelector: "work",
        resourceType: "skill",
        resourceName: "manual-skill",
        scope: "home",
        harness: "claude-code",
        path: ".claude/skills/manual-skill/SKILL.md",
      });

      expect(committed.name).toBe("manual-skill");
      const library = getResource(skill.id);
      expect(library?.content).toContain("# updated live");
    } finally {
      await context.cleanup();
    }
  });
});
