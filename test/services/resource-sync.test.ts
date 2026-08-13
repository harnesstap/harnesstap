import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource, getResource } from "../../src/models/resource.ts";

const pluginImportFixtureRoot = join(import.meta.dirname, "../fixtures/plugin-import");

describe("resource-sync service", () => {
  it("refreshes marketplace_link resource when install tree content changes", async () => {
    const context = await createInitializedTestContext("resource-sync-refresh");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { syncLinkedResources } = await import("../../src/services/resource-sync.ts");

      await scanner.scanAndPersistPluginSource(
        join(pluginImportFixtureRoot, "cursor-team-kit"),
      );

      const before = resourceModel
        .listResources()
        .find((resource) => resource.name === "team");
      expect(before?.origin_kind).toBe("marketplace_link");

      const result = await syncLinkedResources({
        selector: "skill:team@cursor-team-kit",
        policy: "overwrite",
        claudePluginsRoot: join(context.homeDir, ".claude", "plugins"),
        homeRoot: context.homeDir,
      });

      expect(result.checked).toBeGreaterThanOrEqual(0);
    } finally {
      await context.cleanup();
    }
  });
});

function seedLinkedSkill(homeDir: string, content: string, metadata: Record<string, unknown> = {}) {
  const installRoot = join(
    homeDir,
    ".claude",
    "plugins",
    "cache",
    "fixture-mkt",
    "cursor-team-kit",
  );
  mkdirSync(join(installRoot, ".."), { recursive: true });
  cpSync(join(pluginImportFixtureRoot, "cursor-team-kit"), installRoot, { recursive: true });
  return createResource({
    type: "skill",
    name: "team",
    namespace: "cursor-team-kit",
    description: "cached",
    content,
    metadata,
    source: "marketplace",
    origin_kind: "marketplace_link",
    origin_ref: "cursor-team-kit@fixture-mkt",
  });
}

describe("resource-sync dry-run classification", () => {
  it("reports updated without persisting when the install tree differs", async () => {
    const context = await createInitializedTestContext("resource-sync-dry-run");
    try {
      const { syncLinkedResources } = await import("../../src/services/resource-sync.ts");
      const before = seedLinkedSkill(context.homeDir, "# stale cache\n");
      const result = await syncLinkedResources({
        selector: before.id,
        onConflict: "fail",
        policy: "fail",
        dryRun: true,
        homeRoot: context.homeDir,
      });
      expect(result.updated.length).toBe(1);
      expect(result.updated[0]?.id).toBe(before.id);
      const after = getResource(before.id);
      expect(after?.content).toBe("# stale cache\n");
      expect(after?.updated_at).toBe(before.updated_at);
    } finally {
      await context.cleanup();
    }
  });

  it("persists on apply after a differing install tree", async () => {
    const context = await createInitializedTestContext("resource-sync-apply");
    try {
      const { syncLinkedResources } = await import("../../src/services/resource-sync.ts");
      const before = seedLinkedSkill(context.homeDir, "# stale cache\n");
      const result = await syncLinkedResources({
        selector: before.id,
        onConflict: "overwrite",
        policy: "overwrite",
        dryRun: false,
        homeRoot: context.homeDir,
      });
      expect(result.updated.length).toBe(1);
      const after = getResource(before.id);
      expect(after?.content).toContain("shared team review checklist");
    } finally {
      await context.cleanup();
    }
  });

  it("records stale when the install path is missing", async () => {
    const context = await createInitializedTestContext("resource-sync-stale");
    try {
      const { syncLinkedResources } = await import("../../src/services/resource-sync.ts");
      const resource = createResource({
        type: "skill",
        name: "gone",
        description: "missing tree",
        content: "# gone\n",
        metadata: {},
        source: "marketplace",
        origin_kind: "marketplace_link",
        origin_ref: "missing-plugin@missing-mkt",
      });
      const result = await syncLinkedResources({
        selector: resource.id,
        dryRun: true,
        homeRoot: context.homeDir,
      });
      expect(result.stale.length).toBe(1);
      expect(result.stale[0]?.reason).toMatch(/install path not found/);
    } finally {
      await context.cleanup();
    }
  });

  it("skips pinned rows without force", async () => {
    const context = await createInitializedTestContext("resource-sync-pinned");
    try {
      const { syncLinkedResources } = await import("../../src/services/resource-sync.ts");
      const before = seedLinkedSkill(context.homeDir, "# stale cache\n", {
        sync_status: "pinned",
      });
      const result = await syncLinkedResources({
        selector: before.id,
        onConflict: "overwrite",
        policy: "overwrite",
        dryRun: true,
        homeRoot: context.homeDir,
      });
      expect(result.skipped.some((row) => row.id === before.id)).toBe(true);
      expect(result.updated.length).toBe(0);
    } finally {
      await context.cleanup();
    }
  });
});
