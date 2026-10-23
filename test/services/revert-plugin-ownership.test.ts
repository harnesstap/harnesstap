import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import {
  hostPluginViewWrittenHash,
  readHostPluginViewRecord,
} from "../../src/services/package-cache/host-plugin-views.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import {
  heldBackByRegistry,
  withoutEnabledKeys,
} from "../../src/services/revert-plugin-registry.ts";
import {
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
  hashOnDiskFile,
} from "../../src/services/safe-file-removal.ts";
import { executeRevert, resolveRevertPlan, type RevertPlan } from "../../src/services/snapshot-revert.ts";
import { resolveHomeRoot } from "../../src/utils/home-root.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A plugin folder HarnessTap made, removed by an apply and restored by a
// revert, is HarnessTap's again: the next apply removes it instead of calling
// it the user's. A plugin whose registration the revert keeps out stays out
// whole, cache files and enabledPlugins key included.
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("revert-plugin-own-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";
const MANIFEST = `${VIEW}/.claude-plugin/plugin.json`;
const SKILL = `${VIEW}/skills/dup-skill/SKILL.md`;
const REGISTRY = ".claude/plugins/installed_plugins.json";
const MARKETS = ".claude/plugins/known_marketplaces.json";
const SETTINGS = ".claude/settings.json";

function mirror(home: string): void {
  const canonical = createTempDir("revert-plugin-own-pkg");
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
}

function own(home: string, path: string): void {
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

function removeAndRevert(home: string, plan?: (id: string) => void): ReturnType<typeof executeRevert> {
  const snapshot = createGlobalApplySnapshot({ profile_name: "two", plugin_ids: [] });
  const removal = executeSafeFileRemovals(home, [MANIFEST, SKILL], {
    applyId: snapshot.id,
    snapshotId: snapshot.id,
  });
  expect(removal.removed).toHaveLength(2);
  expect(existsSync(join(home, ".claude/plugins/cache/mkta"))).toBe(false);
  expect(readHostPluginViewRecord(join(home, VIEW))).toBeUndefined();
  plan?.(snapshot.id);
  const revert = resolveRevertPlan(snapshot.id);
  if ("error" in revert) throw new Error(revert.error);
  return executeRevert(revert);
}

describe("revert gives a restored plugin folder back to HarnessTap", () => {
  it("records the restored files and the folder, so the next removal takes them", () => {
    const home = resolveHomeRoot();
    mirror(home);
    for (const path of [MANIFEST, SKILL]) own(home, path);

    const result = removeAndRevert(home);

    expect(result.warnings).toEqual([]);
    const record = readHostPluginViewRecord(join(home, VIEW));
    expect(record?.created).toBe(true);
    expect(Object.keys(record?.files ?? {}).sort()).toEqual([".claude-plugin/plugin.json", "skills/dup-skill/SKILL.md"]);
    expect(hostPluginViewWrittenHash(join(home, SKILL))).toBe(hashOnDiskFile(join(home, SKILL)));

    const again = executeSafeFileRemovals(home, [MANIFEST, SKILL]);
    expect(again.skipped).toEqual([]);
    expect(again.removed).toEqual([MANIFEST, SKILL]);
    expect(existsSync(join(home, ".claude/plugins/cache/mkta"))).toBe(false);
  });

  it("does not claim a folder that holds a file of the user's, only the files HarnessTap wrote", () => {
    const home = resolveHomeRoot();
    mirror(home);
    for (const path of [MANIFEST, SKILL]) own(home, path);

    removeAndRevert(home, () => {
      writeTextFile(join(home, VIEW, "notes.md"), "mine\n");
    });

    const record = readHostPluginViewRecord(join(home, VIEW));
    expect(record?.created).toBe(false);
    expect(record?.files["notes.md"]).toBeUndefined();
    const again = executeSafeFileRemovals(home, [MANIFEST, SKILL]);
    expect(again.removed).toEqual([MANIFEST, SKILL]);
    expect(readFileSync(join(home, VIEW, "notes.md"), "utf8")).toBe("mine\n");
  });

  it("does not record a restored file whose bytes are not what HarnessTap wrote", () => {
    const home = resolveHomeRoot();
    mirror(home);
    for (const path of [MANIFEST, SKILL]) own(home, path);
    const snapshot = createGlobalApplySnapshot({ profile_name: "two", plugin_ids: [] });
    writeTextFile(join(home, SKILL), "# my edit\n");
    executeSafeFileRemovals(home, [MANIFEST, SKILL], {
      applyId: snapshot.id,
      snapshotId: snapshot.id,
      forceRemove: true,
    });
    const plan = resolveRevertPlan(snapshot.id);
    if ("error" in plan) throw new Error(plan.error);
    executeRevert(plan);

    const record = readHostPluginViewRecord(join(home, VIEW));
    expect(record?.files[".claude-plugin/plugin.json"]).toBeDefined();
    expect(record?.files["skills/dup-skill/SKILL.md"]).toBeUndefined();
    expect(classifyManagedPathOwnership(home, SKILL)).toBe("unowned");
  });
});

describe("revert restores a plugin whole or not at all", () => {
  const files = [
    { path: REGISTRY, content: JSON.stringify({ version: 2, plugins: { "dup@mkta": [{}], "two@mkta": [{}] } }) },
    { path: MARKETS, content: JSON.stringify({ mkta: {} }) },
    { path: `${VIEW}/skills/a.md`, content: "a" },
    { path: ".claude/plugins/cache/mkta/two/1.0.0/b.md", content: "b" },
    { path: ".claude/plugins/cache/other/x/1.0.0/c.md", content: "c" },
    { path: SETTINGS, content: `${JSON.stringify({ enabledPlugins: { "dup@mkta": true, "x@other": true } }, null, 2)}\n` },
  ];

  it("holds back every plugin the kept installed_plugins.json would have registered", () => {
    const held = heldBackByRegistry(files, new Set([REGISTRY]));
    expect(held?.prefixes).toEqual([
      ".claude/plugins/cache/mkta/dup/",
      ".claude/plugins/cache/mkta/two/",
    ]);
    expect(held?.enabledKeys).toEqual(["dup@mkta", "two@mkta"]);
    expect(held?.skips).toHaveLength(1);
    expect(held?.skips[0]?.message).toContain("dup@mkta, two@mkta");
  });

  it("holds back the plugins of a marketplace the kept known_marketplaces.json would have registered", () => {
    const held = heldBackByRegistry(files, new Set([MARKETS]));
    expect(held?.prefixes).toContain(".claude/plugins/cache/mkta/");
    expect(held?.prefixes).not.toContain(".claude/plugins/cache/other/");
    expect(held?.enabledKeys.sort()).toEqual(["dup@mkta", "two@mkta"]);
  });

  it("holds nothing back when the registries are restored", () => {
    expect(heldBackByRegistry(files, new Set([SETTINGS]))).toBeUndefined();
  });

  it("drops only the held keys from settings.json and keeps its formatting", () => {
    const content = files.find((file) => file.path === SETTINGS)?.content ?? "";
    const next = withoutEnabledKeys(content, ["dup@mkta"]);
    expect(next).toBe(`${JSON.stringify({ enabledPlugins: { "x@other": true } }, null, 2)}\n`);
  });

  it("keeps a plugin out of the revert, cache files and enabledPlugins key, when the user's registry is kept", () => {
    const home = resolveHomeRoot();
    const mine = `${JSON.stringify({ version: 2, plugins: { "mine@mymkt": [{}] } })}\n`;
    writeTextFile(join(home, REGISTRY), mine);
    const plan: RevertPlan = {
      kind: "global",
      id: "01TESTREVERTPLUGINREGISTRY0000",
      rootPath: home,
      label: "default",
      createdAt: new Date().toISOString(),
      restoreFiles: files.filter((file) => file.path !== MARKETS && !file.path.includes("/other/")),
      absentPaths: [],
      hasCapturedState: true,
    };

    const dry = executeRevert(plan, { dryRun: true });
    const real = executeRevert(plan);

    expect(real.warnings).toEqual(dry.warnings);
    expect(real.warnings.some((warning) => warning.includes("dup@mkta, two@mkta"))).toBe(true);
    expect(readFileSync(join(home, REGISTRY), "utf8")).toBe(mine);
    expect(existsSync(join(home, VIEW))).toBe(false);
    expect(existsSync(join(home, ".claude/plugins/cache/mkta"))).toBe(false);
    expect(JSON.parse(readFileSync(join(home, SETTINGS), "utf8"))).toEqual({
      enabledPlugins: { "x@other": true },
    });
    expect(real.restored).not.toContain(`${VIEW}/skills/a.md`);
  });

  it("keeps the live value of a held key instead of dropping it", () => {
    const content = `${JSON.stringify({ enabledPlugins: { "dup@mkta": true, "x@other": true } }, null, 2)}\n`;
    const live = `${JSON.stringify({ enabledPlugins: { "dup@mkta": false } }, null, 2)}\n`;
    expect(JSON.parse(withoutEnabledKeys(content, ["dup@mkta"], live))).toEqual({
      enabledPlugins: { "dup@mkta": false, "x@other": true },
    });
    expect(JSON.parse(withoutEnabledKeys(content, ["dup@mkta"], "{}"))).toEqual({
      enabledPlugins: { "x@other": true },
    });
  });

  it("does not hold back a plugin the user installed with Claude Code", () => {
    const claudeRow = {
      scope: "user",
      installPath: "/h/.claude/plugins/cache/mymkt/myplug/1.0.0",
      version: "1.0.0",
      installedAt: "2026-10-01T00:00:00.000Z",
      lastUpdated: "2026-10-01T00:00:00.000Z",
      gitCommitSha: "abc",
    };
    const htRow = { scope: "user", installPath: "/h/.claude/plugins/cache/mkta/dup/1.0.0", version: "1.0.0" };
    const registry = JSON.stringify({ version: 2, plugins: { "myplug@mymkt": [claudeRow], "dup@mkta": [htRow] } });
    const held = heldBackByRegistry([{ path: REGISTRY, content: registry }], new Set([REGISTRY]));
    expect(held?.enabledKeys).toEqual(["dup@mkta"]);
    expect(held?.prefixes).toEqual([".claude/plugins/cache/mkta/dup/"]);
  });

  it("a revert keeps the user's own enabledPlugins key when their registry is kept", () => {
    const home = resolveHomeRoot();
    const claudeRow = {
      scope: "user",
      installPath: join(home, ".claude/plugins/cache/mymkt/myplug/1.0.0"),
      version: "1.0.0",
      installedAt: "2026-10-01T00:00:00.000Z",
      lastUpdated: "2026-10-01T00:00:00.000Z",
      gitCommitSha: "abc",
    };
    const registry = `${JSON.stringify({ version: 2, plugins: { "myplug@mymkt": [claudeRow] } })}\n`;
    const settings = `${JSON.stringify({ enabledPlugins: { "myplug@mymkt": true } }, null, 2)}\n`;
    writeTextFile(join(home, REGISTRY), `${registry}\n`);
    writeTextFile(join(home, SETTINGS), settings);
    const plan: RevertPlan = {
      kind: "global",
      id: "01TESTREVERTUSERPLUGINKEY0000",
      rootPath: home,
      label: "default",
      createdAt: new Date().toISOString(),
      restoreFiles: [
        { path: REGISTRY, content: registry },
        { path: SETTINGS, content: settings },
      ],
      absentPaths: [],
      hasCapturedState: true,
    };

    executeRevert(plan);

    expect(JSON.parse(readFileSync(join(home, SETTINGS), "utf8"))).toEqual({
      enabledPlugins: { "myplug@mymkt": true },
    });
  });
});
