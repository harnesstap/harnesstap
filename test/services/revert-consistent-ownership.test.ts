import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  backUpAndRemoveHostPluginViewFiles,
  restoreHostPluginViewBackup,
} from "../../src/services/package-cache/host-plugin-view-backups.ts";
import { planHostPluginViewRemovals } from "../../src/services/package-cache/host-plugin-view-ownership.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import { readHostPluginViewRecord } from "../../src/services/package-cache/host-plugin-views.ts";
import {
  heldBackByRegistry,
  registersNoPlugin,
  withSnapshotSettingsKeys,
  withoutInstalledRecords,
} from "../../src/services/revert-plugin-registry.ts";
import { executeRevert, type RevertPlan } from "../../src/services/snapshot-revert.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { resolveHomeRoot } from "../../src/utils/home-root.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A revert leaves ownership consistent: files it puts back are HarnessTap's
// again, settings.json gets its keys back key by key, and a plugin that cannot
// be restored whole is not restored at all, registry record and key included.
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("revert-consistent-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/mkc/pl/1.0.0";
const REGISTRY = ".claude/plugins/installed_plugins.json";
const SETTINGS = ".claude/settings.json";

describe("a reverted host plugin file", () => {
  it("is replaced and removed by the next refresh instead of kept as a stranger", () => {
    const dir = createTempDir("revert-consistent-pkg");
    try {
      writeTextFile(join(dir, ".claude-plugin/plugin.json"), '{"name":"pl","version":"1.0.0"}\n');
      writeTextFile(join(dir, "skills/s/SKILL.md"), "v1\n");
      const homeRoot = ctx.homeDir;
      mirrorHostPluginView({ homeRoot, marketplace: "mkc", pluginName: "pl", version: "1.0.0", canonicalDir: dir });
      const hostView = join(homeRoot, VIEW);
      const id = backUpAndRemoveHostPluginViewFiles({
        homeRoot,
        hostView,
        paths: [".claude-plugin/plugin.json", "skills/s/SKILL.md"],
      });
      expect(id).toBeDefined();
      expect(existsSync(join(hostView, "skills/s/SKILL.md"))).toBe(false);

      const restored = restoreHostPluginViewBackup(id as string);
      expect(restored?.restored).toHaveLength(2);
      const record = readHostPluginViewRecord(hostView);
      expect(Object.keys(record?.files ?? {}).sort()).toEqual([".claude-plugin/plugin.json", "skills/s/SKILL.md"]);
      const plan = planHostPluginViewRemovals({ homeRoot, hostView, paths: ["skills/s/SKILL.md"] });
      expect(plan.refused).toEqual([]);
      expect(plan.allowed).toEqual(["skills/s/SKILL.md"]);
    } finally {
      cleanupDir(dir);
    }
  });

  it("is not recorded when the restored bytes are not what HarnessTap wrote", () => {
    const dir = createTempDir("revert-consistent-pkg2");
    try {
      writeTextFile(join(dir, ".claude-plugin/plugin.json"), '{"name":"pl","version":"1.0.0"}\n');
      writeTextFile(join(dir, "skills/s/SKILL.md"), "v1\n");
      const homeRoot = ctx.homeDir;
      mirrorHostPluginView({ homeRoot, marketplace: "mkc", pluginName: "pl", version: "1.0.0", canonicalDir: dir });
      const hostView = join(homeRoot, VIEW);
      writeFileSync(join(hostView, "skills/s/SKILL.md"), "mine\n");
      const id = backUpAndRemoveHostPluginViewFiles({ homeRoot, hostView, paths: ["skills/s/SKILL.md"] });
      expect(id).toBeDefined();
      restoreHostPluginViewBackup(id as string);
      expect(readFileSync(join(hostView, "skills/s/SKILL.md"), "utf8")).toBe("mine\n");
      const record = readHostPluginViewRecord(hostView);
      expect(record?.files["skills/s/SKILL.md"]).toBeUndefined();
      expect(record?.files[".claude-plugin/plugin.json"]).toBeDefined();
    } finally {
      cleanupDir(dir);
    }
  });
});

describe("withSnapshotSettingsKeys", () => {
  const snapshot = JSON.stringify({
    theme: "dark",
    enabledPlugins: { "a@m": true, "b@m": true },
    extraKnownMarketplaces: { m: { source: { source: "directory", path: "/p" } } },
  });

  it("adds the snapshot keys the live file lacks and nothing else", () => {
    const live = `${JSON.stringify({ theme: "light", enabledPlugins: { "b@m": false } }, null, 2)}\n`;
    const next = JSON.parse(withSnapshotSettingsKeys(snapshot, live) ?? "{}");
    expect(next.theme).toBe("light");
    expect(next.enabledPlugins).toEqual({ "b@m": false, "a@m": true });
    expect(Object.keys(next.extraKnownMarketplaces)).toEqual(["m"]);
  });

  it("returns the live file when there is nothing to add and undefined for a non-object", () => {
    const live = JSON.stringify({ enabledPlugins: { "a@m": false, "b@m": true }, extraKnownMarketplaces: { m: {} } });
    expect(withSnapshotSettingsKeys(snapshot, live)).toBe(live);
    expect(withSnapshotSettingsKeys(snapshot, "not json")).toBeUndefined();
    expect(withSnapshotSettingsKeys("[]", "{}")).toBeUndefined();
  });
});

describe("withoutInstalledRecords", () => {
  const content = `${JSON.stringify({ version: 2, plugins: { "a@m": [{ v: 1 }], "b@m": [{ v: 2 }] } }, null, 2)}\n`;

  it("drops the held refs, keeps the others and the formatting", () => {
    expect(withoutInstalledRecords(content, ["a@m"])).toBe(
      `${JSON.stringify({ version: 2, plugins: { "b@m": [{ v: 2 }] } }, null, 2)}\n`,
    );
  });

  it("keeps the live record of a held ref", () => {
    const live = JSON.stringify({ version: 2, plugins: { "a@m": [{ v: 9 }] } });
    expect(JSON.parse(withoutInstalledRecords(content, ["a@m"], live)).plugins["a@m"]).toEqual([{ v: 9 }]);
  });

  it("tells when nothing is registered", () => {
    expect(registersNoPlugin(withoutInstalledRecords(content, ["a@m", "b@m"]))).toBe(true);
    expect(registersNoPlugin(content)).toBe(false);
  });
});

describe("a revert with part of a plugin blocked", () => {
  const htRow = (home: string) => ({
    scope: "user",
    installPath: join(home, VIEW),
    version: "1.0.0",
  });

  function plan(home: string): RevertPlan {
    const registry = `${JSON.stringify({ version: 2, plugins: { "pl@mkc": [htRow(home)] } }, null, 2)}\n`;
    const settings = `${JSON.stringify({ enabledPlugins: { "pl@mkc": true, "x@y": true } }, null, 2)}\n`;
    return {
      kind: "global",
      id: "01TESTREVERTWHOLEPLUGIN000000",
      rootPath: home,
      label: "default",
      createdAt: new Date().toISOString(),
      restoreFiles: [
        { path: REGISTRY, content: registry },
        { path: SETTINGS, content: settings },
        { path: `${VIEW}/.claude-plugin/plugin.json`, content: "{}\n" },
        { path: `${VIEW}/skills/s/SKILL.md`, content: "v1\n" },
      ],
      absentPaths: [],
      hasCapturedState: true,
    };
  }

  it("restores none of the plugin: no files, no record, no enabledPlugins key", () => {
    const home = resolveHomeRoot();
    writeTextFile(join(home, VIEW, "skills/s"), "USER FILE\n");

    const dry = executeRevert(plan(home), { dryRun: true });
    const real = executeRevert(plan(home));

    expect(real.warnings).toEqual(dry.warnings);
    expect(real.warnings.some((w) => w.includes("pl@mkc as a whole"))).toBe(true);
    expect(existsSync(join(home, VIEW, ".claude-plugin/plugin.json"))).toBe(false);
    expect(readFileSync(join(home, VIEW, "skills/s"), "utf8")).toBe("USER FILE\n");
    expect(existsSync(join(home, REGISTRY))).toBe(false);
    expect(JSON.parse(readFileSync(join(home, SETTINGS), "utf8"))).toEqual({ enabledPlugins: { "x@y": true } });
  });

  it("restores the whole plugin when nothing is in the way", () => {
    const home = resolveHomeRoot();
    const real = executeRevert(plan(home));
    expect(real.warnings).toEqual([]);
    expect(readFileSync(join(home, VIEW, "skills/s/SKILL.md"), "utf8")).toBe("v1\n");
    expect(JSON.parse(readFileSync(join(home, REGISTRY), "utf8")).plugins["pl@mkc"]).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(home, SETTINGS), "utf8")).enabledPlugins["pl@mkc"]).toBe(true);
  });

  it("holds the plugin back by its blocked paths", () => {
    const registry = JSON.stringify({ version: 2, plugins: { "pl@mkc": [{ scope: "user", installPath: `/h/${VIEW}`, version: "1.0.0" }] } });
    const files = [
      { path: REGISTRY, content: registry },
      { path: `${VIEW}/a.md`, content: "a" },
    ];
    const held = heldBackByRegistry(files, new Set([`${VIEW}/a.md`]));
    expect(held?.prefixes).toEqual([".claude/plugins/cache/mkc/pl/"]);
    expect(held?.enabledKeys).toEqual(["pl@mkc"]);
    expect(held?.recordKeys).toEqual(["pl@mkc"]);
  });
});

describe("a revert of settings.json HarnessTap rewrote since", () => {
  it("puts the snapshot's plugin keys back key by key and keeps the rest", () => {
    const home = resolveHomeRoot();
    const written = `${JSON.stringify({ enabledPlugins: { "a@m": true } }, null, 2)}\n`;
    writeTextFile(join(home, SETTINGS), written);
    const resource = createResource({
      type: "plugin",
      name: "settings-owner",
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
      path: SETTINGS,
      action: "edit-file",
      ownership_key: "plugin:settings-owner",
      generated_hash: "0".repeat(64),
    });
    // The switch away pruned a key and the user added theme since.
    writeTextFile(join(home, SETTINGS), `${JSON.stringify({ theme: "dark", enabledPlugins: { "u@m": false } }, null, 2)}\n`);

    const plan: RevertPlan = {
      kind: "global",
      id: "01TESTREVERTSETTINGSMERGE0000",
      rootPath: home,
      label: "staff",
      createdAt: new Date().toISOString(),
      restoreFiles: [{ path: SETTINGS, content: written }],
      absentPaths: [],
      hasCapturedState: true,
    };
    const result = executeRevert(plan);

    expect(JSON.parse(readFileSync(join(home, SETTINGS), "utf8"))).toEqual({
      theme: "dark",
      enabledPlugins: { "u@m": false, "a@m": true },
    });
    expect(result.restored).toContain(SETTINGS);
  });
});
