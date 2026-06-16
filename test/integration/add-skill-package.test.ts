import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { addSkillPackage } from "../../src/services/add-package.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("addSkillPackage integration", () => {
  it("imports and installs selected skills from local source", async () => {
    const context = await createInitializedTestContext("add-skill-package");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({
        main_harness: "codex",
        alias_harnesses: ["claude-code"],
      });

      const result = await addSkillPackage({
        source: fixture,
        skillNames: ["caveman", "tdd"],
        scope: "global",
        method: "symlink",
        homeRoot: context.homeDir,
        harnessdeckDir: join(context.homeDir, ".harnessdeck"),
      });

      expect(result.importedSkills.sort()).toEqual(["caveman", "tdd", "triage"]);
      expect(result.installedSkills.sort()).toEqual(["caveman", "tdd"]);
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(true);
      expect(existsSync(join(context.homeDir, ".agents/skills/tdd"))).toBe(true);

      const { findResourceByKey } = await import("../../src/models/resource.ts");
      expect(findResourceByKey("skill", "tdd", result.namespace)).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("creates layer with skill refs when createLayer set", async () => {
    const context = await createInitializedTestContext("add-create-layer");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ main_harness: "codex", alias_harnesses: [] });
      await addSkillPackage({
        source: fixture,
        skillNames: ["caveman"],
        scope: "global",
        method: "symlink",
        homeRoot: context.homeDir,
        harnessdeckDir: join(context.homeDir, ".harnessdeck"),
        createLayer: "mattpocock-skills",
      });
      const { getPlugin, getPluginResources } = await import("../../src/models/plugin-component.ts");
      const layer = getPlugin("mattpocock-skills");
      expect(layer).toBeDefined();
      if (!layer) throw new Error("Expected mattpocock-skills layer");
      const attached = getPluginResources(layer.id);
      expect(attached.some((r) => r.type === "skill" && r.name === "caveman")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
