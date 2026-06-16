import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

const ponytailFixture = join(import.meta.dirname, "../fixtures/ponytail/full");
const superpowersFixture = join(
  import.meta.dirname,
  "../fixtures/superpowers/minimal",
);

describe("syncProject reference strategies", () => {
  it("falls back to plugin-imported skills when main harness scan is empty", async () => {
    const context = await createInitializedTestContext("project-sync-auto");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const result = await syncProject({
        projectRoot: ponytailFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "auto",
      });

      expect(result.files_written).toBeGreaterThan(0);
      expect(result.main_harness).toBe("claude-code");
    } finally {
      await context.cleanup();
    }
  });

  it("uses plugin source when reference strategy is plugin", async () => {
    const context = await createInitializedTestContext("project-sync-plugin");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const result = await syncProject({
        projectRoot: ponytailFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "plugin",
      });

      expect(result.files_written).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("uses AGENTS.md instructions when reference strategy is agents", async () => {
    const context = await createInitializedTestContext("project-sync-agents");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const result = await syncProject({
        projectRoot: ponytailFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "agents",
      });

      expect(result.files_written).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("throws on main strategy when claude-code has no on-disk resources", async () => {
    const context = await createInitializedTestContext("project-sync-main-empty");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      await expect(
        syncProject({
          projectRoot: ponytailFixture,
          dryRun: true,
          forceShiftReference: "claude-code",
          referenceStrategy: "main",
        }),
      ).rejects.toThrow(/no on-disk resources/);
    } finally {
      await context.cleanup();
    }
  });

  it("throws actionable error when auto fallback finds no resources", async () => {
    const context = await createInitializedTestContext("project-sync-auto-empty");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      await expect(
        syncProject({
          projectRoot: join(context.projectDir),
          dryRun: true,
          forceShiftReference: "claude-code",
          referenceStrategy: "auto",
        }),
      ).rejects.toThrow(/--reference plugin/);
      await expect(
        syncProject({
          projectRoot: join(context.projectDir),
          dryRun: true,
          forceShiftReference: "claude-code",
          referenceStrategy: "auto",
        }),
      ).rejects.toThrow(/harnessdeck project scan/);
    } finally {
      await context.cleanup();
    }
  });

  it("merges plugin skills when main harness has instructions only", async () => {
    const context = await createInitializedTestContext("project-sync-sp-auto");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const auto = await syncProject({
        projectRoot: superpowersFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "auto",
      });
      const pluginOnly = await syncProject({
        projectRoot: superpowersFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "plugin",
      });

      expect(auto.files_written).toBeGreaterThan(pluginOnly.files_written * 0.5);
      expect(auto.files_written).toBeGreaterThan(pluginOnly.files_written);
    } finally {
      await context.cleanup();
    }
  });

  it("main strategy still uses main harness only", async () => {
    const context = await createInitializedTestContext("project-sync-sp-main");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const [main, auto] = await Promise.all([
        syncProject({
          projectRoot: superpowersFixture,
          dryRun: true,
          forceShiftReference: "claude-code",
          referenceStrategy: "main",
        }),
        syncProject({
          projectRoot: superpowersFixture,
          dryRun: true,
          forceShiftReference: "claude-code",
          referenceStrategy: "auto",
        }),
      ]);

      expect(main.files_written).toBeLessThan(auto.files_written);
    } finally {
      await context.cleanup();
    }
  });

  it("reports harness-specific surface warnings for alias harnesses", async () => {
    const context = await createInitializedTestContext("project-sync-warnings");
    const geminiFixture = join(import.meta.dirname, "../fixtures/ponytail/gemini");

    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const result = await syncProject({
        projectRoot: geminiFixture,
        dryRun: true,
        forceShiftReference: "gemini-cli",
        referenceStrategy: "auto",
      });

      expect(result.surface_warnings.length).toBeGreaterThan(0);
      expect(result.surface_warnings[0]?.category).toBe("gemini-extension");
    } finally {
      await context.cleanup();
    }
  });
});
