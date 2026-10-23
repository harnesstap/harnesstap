import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { createGlobalApplySnapshot, getGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import { executeSafeFileRemovals } from "../../src/services/safe-file-removal.ts";
import { captureManagedSnapshotState } from "../../src/services/snapshot-capture.ts";
import { executeRevert, resolveRevertPlan } from "../../src/services/snapshot-revert.ts";

function seedOwned(context: TestContext, relative: string, content: string): void {
  const full = join(context.homeDir, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
  const resource = createResource({
    type: "skill",
    name: relative.replace(/[^a-z0-9]/gi, "-"),
    description: "",
    content,
    metadata: {},
    source: "manual",
  });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "global",
    root_path: context.homeDir,
    platform_id: "claude-code",
    path: relative,
    action: "delete-file",
    ownership_key: `skill:${resource.name}`,
    generated_hash: hashGeneratedContent(content),
  });
}

describe("snapshots that leave removed files to the removal backups", () => {
  it("stores no file bytes in the snapshot, and revert restores the removed files", async () => {
    const context = await createInitializedTestContext("snap-trashed-");
    try {
      const big = "line of plugin text\n".repeat(20000);
      seedOwned(context, ".claude/plugins/cache/p/big.md", big);
      seedOwned(context, ".claude/plugins/cache/p/small.md", "small\n");
      seedOwned(context, ".claude/plugins/cache/p/edited.md", "original\n");
      writeFileSync(join(context.homeDir, ".claude/plugins/cache/p/edited.md"), "my edit\n");
      const paths = [
        ".claude/plugins/cache/p/big.md",
        ".claude/plugins/cache/p/small.md",
        ".claude/plugins/cache/p/edited.md",
        ".claude/plugins/cache/p/gone.md",
      ];
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [],
        removalBackedPaths: paths,
      });
      expect(state.disk_files).toBeUndefined();
      expect(state.trashed_files).toEqual(paths.slice(0, 3));
      expect(state.absent_paths).toEqual([paths[3]!]);

      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      expect(JSON.stringify(getGlobalApplySnapshot(snapshot.id)?.state).length).toBeLessThan(2000);

      const removal = executeSafeFileRemovals(context.homeDir, paths, {
        applyId: snapshot.id,
        snapshotId: snapshot.id,
        forceRemove: true,
      });
      expect(removal.removed).toHaveLength(3);
      expect(existsSync(join(context.homeDir, paths[0]!))).toBe(false);

      const plan = resolveRevertPlan(snapshot.id);
      if ("error" in plan) throw new Error(plan.error);
      expect(plan.hasCapturedState).toBe(true);
      const result = executeRevert(plan);
      expect(result.warnings).toEqual([]);
      expect(readFileSync(join(context.homeDir, paths[0]!), "utf-8")).toBe(big);
      expect(readFileSync(join(context.homeDir, paths[1]!), "utf-8")).toBe("small\n");
      expect(readFileSync(join(context.homeDir, paths[2]!), "utf-8")).toBe("my edit\n");
    } finally {
      await context.cleanup();
    }
  });

  it("leaves a tracked file alone when the apply did not remove it", async () => {
    const context = await createInitializedTestContext("snap-trashed-kept-");
    try {
      const path = ".claude/plugins/cache/p/kept.md";
      seedOwned(context, path, "original\n");
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [],
        removalBackedPaths: [path],
      });
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      writeFileSync(join(context.homeDir, path), "edited after the apply\n");
      const plan = resolveRevertPlan(snapshot.id);
      if ("error" in plan) throw new Error(plan.error);
      const result = executeRevert(plan);
      expect(result.restored).toEqual([]);
      expect(readFileSync(join(context.homeDir, path), "utf-8")).toBe("edited after the apply\n");
    } finally {
      await context.cleanup();
    }
  });

  it("restores the same bytes on a second revert of the same snapshot", async () => {
    const context = await createInitializedTestContext("snap-trashed-twice-");
    try {
      const path = ".claude/plugins/cache/p/twice.md";
      seedOwned(context, path, "first\n");
      const state = captureManagedSnapshotState({
        rootPath: context.homeDir,
        generated: [],
        removalBackedPaths: [path],
      });
      const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
      executeSafeFileRemovals(context.homeDir, [path], { applyId: snapshot.id, snapshotId: snapshot.id });
      for (let round = 0; round < 2; round += 1) {
        const plan = resolveRevertPlan(snapshot.id);
        if ("error" in plan) throw new Error(plan.error);
        executeRevert(plan);
        expect(readFileSync(join(context.homeDir, path), "utf-8")).toBe("first\n");
        executeSafeFileRemovals(context.homeDir, [path], { applyId: snapshot.id, snapshotId: snapshot.id });
      }
    } finally {
      await context.cleanup();
    }
  });
});
