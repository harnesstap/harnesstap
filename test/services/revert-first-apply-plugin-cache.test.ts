import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hostPluginFilesCreatedForApply } from "../../src/services/host-plugin-install-files.ts";
import {
  hostPluginViewWrittenHash,
  readHostPluginViewRecord,
} from "../../src/services/package-cache/host-plugin-views.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import { hashOnDiskFile } from "../../src/services/safe-file-removal.ts";
import { executeRevert, resolveRevertPlan } from "../../src/services/snapshot-revert.ts";
import { captureManagedSnapshotState } from "../../src/services/snapshot-capture.ts";
import { resolveHomeRoot } from "../../src/utils/home-root.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A profile switch installs a plugin into the host cache before the apply
// runs. The snapshot must not take those files for files that were already
// there, or a revert of that first apply leaves the whole cache behind.
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("revert-first-apply-cache-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";
const MANIFEST = `${VIEW}/.claude-plugin/plugin.json`;
const SKILL = `${VIEW}/skills/dup-skill/SKILL.md`;
const EXTRA = `${VIEW}/README.md`;

function install(home: string): void {
  const canonical = createTempDir("revert-first-apply-pkg");
  try {
    writeTextFile(join(canonical, ".claude-plugin/plugin.json"), '{"name":"dup","version":"1.0.0"}\n');
    writeTextFile(join(canonical, "skills/dup-skill/SKILL.md"), "# dup\n");
    writeTextFile(join(canonical, "README.md"), "# readme\n");
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
}

function ownByApply(home: string, path: string): void {
  const resource = createResource({
    type: "plugin",
    name: `dup-${path.length}`,
    description: "",
    content: "{}",
    metadata: {},
    source: "manual",
  });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "global",
    root_path: home,
    platform_id: "claude-code",
    path,
    action: "delete-file",
    ownership_key: "plugin:dup@mkta",
    generated_hash: hashOnDiskFile(join(home, path)) ?? "",
  });
}

/** What applyToGlobal does for a plugin the apply emits: capture, then record the apply's rows. */
function applyEmitting(home: string, emitted: string[]): string {
  const created = new Set(hostPluginFilesCreatedForApply(home, emitted));
  const state = captureManagedSnapshotState({
    rootPath: home,
    generated: [
      {
        platformId: "claude-code",
        files: emitted.map((path) => ({ path, content: readFileSync(join(home, path), "utf8") })),
      },
    ],
    createdForApply: created,
  });
  const snapshot = createGlobalApplySnapshot({ profile_name: "first", plugin_ids: [], state });
  for (const path of emitted) ownByApply(home, path);
  return snapshot.id;
}

function revert(id: string): ReturnType<typeof executeRevert> {
  const plan = resolveRevertPlan(id);
  if ("error" in plan) throw new Error(plan.error);
  return executeRevert(plan);
}

describe("reverting the first apply of a plugin", () => {
  it("lists the files the install wrote, the ones the apply never emits too", () => {
    const home = resolveHomeRoot();
    install(home);

    expect(hostPluginFilesCreatedForApply(home, [MANIFEST, SKILL]).sort()).toEqual([EXTRA, MANIFEST, SKILL].sort());
  });

  it("removes the cache the install wrote and forgets the folder", () => {
    const home = resolveHomeRoot();
    install(home);

    const result = revert(applyEmitting(home, [MANIFEST, SKILL]));

    expect(result.warnings).toEqual([]);
    expect(result.restored).toEqual([]);
    expect([...result.removed].sort()).toEqual([EXTRA, MANIFEST, SKILL].sort());
    expect(existsSync(join(home, ".claude/plugins/cache/mkta"))).toBe(false);
    expect(readHostPluginViewRecord(join(home, VIEW))).toBeUndefined();
  });

  it("keeps a file the user changed or added, and says so", () => {
    const home = resolveHomeRoot();
    install(home);
    const id = applyEmitting(home, [MANIFEST, SKILL]);
    writeFileSync(join(home, SKILL), "# mine\n");
    writeTextFile(join(home, VIEW, "notes.md"), "mine\n");

    const result = revert(id);

    expect(readFileSync(join(home, SKILL), "utf8")).toBe("# mine\n");
    expect(readFileSync(join(home, VIEW, "notes.md"), "utf8")).toBe("mine\n");
    expect(existsSync(join(home, MANIFEST))).toBe(false);
    expect(existsSync(join(home, EXTRA))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes(SKILL))).toBe(true);
  });

  it("puts a file back that an earlier apply already owned", () => {
    const home = resolveHomeRoot();
    install(home);
    for (const path of [MANIFEST, SKILL]) ownByApply(home, path);
    expect(hostPluginFilesCreatedForApply(home, [MANIFEST, SKILL])).toEqual([EXTRA]);

    const result = revert(applyEmitting(home, [MANIFEST, SKILL]));

    expect(result.restored).toEqual([MANIFEST, SKILL]);
    expect(existsSync(join(home, MANIFEST))).toBe(true);
    expect(existsSync(join(home, SKILL))).toBe(true);
    expect(existsSync(join(home, EXTRA))).toBe(false);
    expect(hostPluginViewWrittenHash(join(home, SKILL))).toBe(hashOnDiskFile(join(home, SKILL)));
  });

  it("does not list a folder Claude Code installed", () => {
    const home = resolveHomeRoot();
    writeTextFile(join(home, SKILL), "# theirs\n");
    writeTextFile(join(home, MANIFEST), '{"name":"dup"}\n');

    expect(hostPluginFilesCreatedForApply(home, [MANIFEST, SKILL])).toEqual([]);
  });
});
