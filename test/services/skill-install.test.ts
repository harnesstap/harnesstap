import { describe, expect, it } from "bun:test";
import { lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { installSkillsToGlobal } from "../../src/services/skill-install.ts";
import { discoverSkillPackage } from "../../src/services/skill-discovery.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-install", () => {
  it("symlinks hub and claude global path to cache skill dir", async () => {
    const context = await createInitializedTestContext("skill-install-global");
    try {
      const skills = discoverSkillPackage(fixture).filter((s) => s.name === "caveman");
      await installSkillsToGlobal({
        checkoutRoot: fixture,
        skills,
        harnesses: ["claude-code", "codex"],
        homeRoot: context.homeDir,
        method: "symlink",
      });

      const hub = join(context.homeDir, ".agents/skills/caveman");
      const claude = join(context.homeDir, ".claude/skills/caveman");
      expect(lstatSync(hub).isSymbolicLink()).toBe(true);
      expect(lstatSync(claude).isSymbolicLink()).toBe(true);
      expect(readlinkSync(claude)).toContain(".agents/skills/caveman");
    } finally {
      await context.cleanup();
    }
  });
});
