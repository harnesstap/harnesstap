import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import {
  backupAndRewriteFile,
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
  hashOnDiskFile,
} from "../../src/services/safe-file-removal.ts";
import { executeRevert, resolveRevertPlan } from "../../src/services/snapshot-revert.ts";
import { resolveHomeRoot } from "../../src/utils/home-root.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// Switching away from a profile removes its files (backed up) and drops their
// ownership rows. `ht revert` must put the files back without failing on the
// missing paths, and make them HarnessTap's again so the next switch removes
// them instead of calling them "not made by HarnessTap".
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("revert-own-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";
const SKILL = `${VIEW}/skills/dup-skill/SKILL.md`;
const AGENTS_SKILL = ".agents/skills/dup-skill/SKILL.md";
const SETTINGS = ".claude/settings.json";

function own(home: string, path: string, resourceId: string): void {
  recordResourceMaterialization({
    resource_id: resourceId,
    scope: "global",
    root_path: home,
    platform_id: "claude-code",
    path,
    action: "delete-file",
    ownership_key: "plugin:dup@mkta",
    generated_hash: hashOnDiskFile(join(home, path)) ?? "",
  });
}

describe("ht revert after an apply removed HarnessTap's files", () => {
  it("restores them, including a host plugin cache folder HarnessTap created, and owns them again", () => {
    const home = resolveHomeRoot();
    const canonical = createTempDir("revert-own-pkg");
    try {
      writeTextFile(join(canonical, ".claude-plugin/plugin.json"), '{"name":"dup","version":"1.0.0"}\n');
      writeTextFile(join(canonical, "skills/dup-skill/SKILL.md"), "# dup\n");
      mirrorHostPluginView({
        homeRoot: home,
        marketplace: "mkta",
        pluginName: "dup",
        version: "1.0.0",
        canonicalDir: canonical,
      });
    } finally {
      cleanupDir(canonical);
    }
    writeTextFile(join(home, AGENTS_SKILL), "# dup skill\n");
    writeTextFile(join(home, SETTINGS), `${JSON.stringify({ enabledPlugins: { "dup@mkta": true } }, null, 2)}\n`);
    const pin = createResource({ type: "plugin", name: "dup", description: "", content: "{}", metadata: {}, source: "manual" });
    for (const path of [SKILL, `${VIEW}/.claude-plugin/plugin.json`, AGENTS_SKILL, SETTINGS]) {
      own(home, path, pin.id);
    }

    const snapshot = createGlobalApplySnapshot({ profile_name: "two", plugin_ids: [] });
    const removal = executeSafeFileRemovals(
      home,
      [SKILL, `${VIEW}/.claude-plugin/plugin.json`, AGENTS_SKILL],
      { applyId: snapshot.id, snapshotId: snapshot.id },
    );
    expect(removal.removed).toHaveLength(3);
    backupAndRewriteFile({
      rootPath: home,
      relativePath: SETTINGS,
      nextContent: null,
      applyId: snapshot.id,
      snapshotId: snapshot.id,
    });
    expect(existsSync(join(home, ".claude/plugins/cache/mkta"))).toBe(false);
    expect(existsSync(join(home, SETTINGS))).toBe(false);
    expect(classifyManagedPathOwnership(home, AGENTS_SKILL)).toBe("unowned");

    const plan = resolveRevertPlan(snapshot.id);
    if ("error" in plan) throw new Error(plan.error);
    const result = executeRevert(plan);

    expect(result.warnings).toEqual([]);
    expect(readFileSync(join(home, SKILL), "utf8")).toBe("# dup\n");
    expect(readFileSync(join(home, AGENTS_SKILL), "utf8")).toBe("# dup skill\n");
    expect(JSON.parse(readFileSync(join(home, SETTINGS), "utf8"))).toEqual({
      enabledPlugins: { "dup@mkta": true },
    });
    for (const path of [SKILL, `${VIEW}/.claude-plugin/plugin.json`, AGENTS_SKILL]) {
      expect(classifyManagedPathOwnership(home, path)).toBe("owned");
    }
    expect(classifyManagedPathOwnership(home, SETTINGS)).not.toBe("unowned");

    // The next switch away removes them again instead of keeping them.
    const again = executeSafeFileRemovals(home, [SKILL, AGENTS_SKILL]);
    expect(again.skipped).toEqual([]);
    expect(again.removed).toEqual([SKILL, AGENTS_SKILL]);
  });

  it("does not own a restored file that no longer matches what HarnessTap wrote", () => {
    const home = resolveHomeRoot();
    writeTextFile(join(home, AGENTS_SKILL), "# dup skill\n");
    const pin = createResource({ type: "plugin", name: "dup", description: "", content: "{}", metadata: {}, source: "manual" });
    own(home, AGENTS_SKILL, pin.id);
    // The user edits it after HarnessTap wrote it, then forces the removal.
    writeTextFile(join(home, AGENTS_SKILL), "# my edit\n");
    const snapshot = createGlobalApplySnapshot({ profile_name: "two", plugin_ids: [] });
    executeSafeFileRemovals(home, [AGENTS_SKILL], {
      applyId: snapshot.id,
      snapshotId: snapshot.id,
      forceRemove: true,
    });

    const plan = resolveRevertPlan(snapshot.id);
    if ("error" in plan) throw new Error(plan.error);
    executeRevert(plan);

    expect(readFileSync(join(home, AGENTS_SKILL), "utf8")).toBe("# my edit\n");
    expect(classifyManagedPathOwnership(home, AGENTS_SKILL)).toBe("unowned");
  });

  it("writes a restored file the apply removed instead of failing on the missing path", () => {
    const home = resolveHomeRoot();
    const snapshot = createGlobalApplySnapshot({ profile_name: "two", plugin_ids: [] });
    expect(() =>
      backupAndRewriteFile({
        rootPath: home,
        relativePath: SKILL,
        nextContent: "# dup\n",
        applyId: snapshot.id,
        snapshotId: snapshot.id,
      }),
    ).not.toThrow();
    expect(readFileSync(join(home, SKILL), "utf8")).toBe("# dup\n");
  });
});
