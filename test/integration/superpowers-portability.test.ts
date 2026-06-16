import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

const fixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("superpowers portability", () => {
  it("scan imports skills once and both hook manifests", async () => {
    const context = await createInitializedTestContext("integration-sp-scan");
    try {
      const scanner = await import("../../src/services/scanner.ts");
      const result = await scanner.persistMergedProjectScan(fixture);
      const skills = result.resources.filter((r) => r.type === "skill");
      const hooks = result.resources.filter((r) => r.type === "hook");
      expect(skills.length).toBe(2);
      expect(hooks.length).toBe(2);
    } finally {
      await context.cleanup();
    }
  });

  it("mirror auto includes plugin skills", async () => {
    const context = await createInitializedTestContext("integration-sp-mirror");
    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const result = await syncProject({
        projectRoot: fixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "auto",
      });
      expect(result.files_written).toBeGreaterThan(10);
      expect(
        result.surface_warnings.some((w) => w.category === "opencode-server-plugin"),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
