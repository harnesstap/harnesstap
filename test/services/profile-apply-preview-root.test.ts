import { describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("previewProfileApply files.root_path + resource", () => {
  it("includes root_path and maps modified skill paths to resource keys", async () => {
    const context = await createInitializedTestContext("preview-root-path");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);
      await applyProfilePlugin("work", {
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

  it("does not list planned removals for paths that are already gone", async () => {
    const context = await createInitializedTestContext("preview-phantom-removal");
    try {
      const full = createPlugin({ name: "full" });
      setPluginTags(full.id, ["profile"]);
      const pairAgent = createResource({
        type: "skill",
        name: "pair-agent",
        description: "",
        content: "# pair-agent",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(full.id, pairAgent.id);

      const slim = createPlugin({ name: "superpowers-only" });
      setPluginTags(slim.id, ["profile"]);
      const kept = createResource({
        type: "skill",
        name: "kept-skill",
        description: "",
        content: "# kept",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(slim.id, kept.id);

      await applyProfilePlugin("full", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("full");

      const gonePath = join(
        context.homeDir,
        ".claude/skills/pair-agent/SKILL.md",
      );
      rmSync(gonePath, { force: true });
      rmSync(join(context.homeDir, ".claude/skills/pair-agent"), {
        recursive: true,
        force: true,
      });
      rmSync(join(context.homeDir, ".agents/skills/pair-agent"), {
        recursive: true,
        force: true,
      });

      const preview = await previewProfileApply({
        profile: "superpowers-only",
        scope: "home",
        harness: "claude-code",
      });

      expect(
        preview.files.changes.some(
          (change) =>
            change.path.includes("pair-agent") && change.type === "added",
        ),
      ).toBe(false);
      expect(
        preview.files.changes.some(
          (change) =>
            change.path === ".claude/skills/kept-skill/SKILL.md"
            && change.type === "deleted",
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
