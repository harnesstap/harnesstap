import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  mirrorHostPluginView,
  planHostPluginViewMirror,
  setHostPluginViewForceReplace,
  takeBlockedHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A dry run follows the plan of the real apply: the plugin folder files it
// would write or keep, the files a user's file keeps it from writing, and the
// same blocked notice (which makes the command exit 1), without touching disk.
let ctx: TestContext;
let dirs: string[] = [];
function reset(): void {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
  takeBlockedHostPluginViewFiles();
}
beforeEach(async () => {
  ctx = await createInitializedTestContext("dry-run-plugin-folder-");
  reset();
  dirs = [];
});
afterEach(async () => {
  reset();
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function marketplace(name: string): string {
  const repo = join(ctx.rootDir, name);
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins/p47/.claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins/p47/skills/s47"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name, owner: { name: "qa" }, plugins: [{ name: "p47", source: "./plugins/p47", description: "p47" }] }),
  );
  writeFileSync(join(repo, "plugins/p47/.claude-plugin/plugin.json"), JSON.stringify({ name: "p47", version: "1.0.0" }));
  writeFileSync(join(repo, "plugins/p47/skills/s47/SKILL.md"), "---\nname: s47\ndescription: v1\n---\nv1\n");
  writeFileSync(join(repo, "plugins/p47/skills/s47/a.md"), "a v1\n");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  return repo;
}

function setupProfile(name: string): string {
  addMarketplace(getHarnesstapDir(), { url: marketplace(name), name, platforms: ["claude-code"] });
  const profile = createPlugin({ name: "pr" });
  setPluginTags(profile.id, ["profile"]);
  addDependency(profile.id, `p47@${name}`);
  setHarnessPreference({ registered_harnesses: ["claude-code"] });
  return join(ctx.homeDir, `.claude/plugins/cache/${name}/p47/1.0.0`);
}

const options = { harness: "claude-code", conflictPolicy: "replace" as const, yes: true };

describe("apply dry run with a user's file in the plugin folder", () => {
  it("reports the files the real apply writes, keeps and cannot write", async () => {
    const folder = setupProfile("mkdry");
    await applyProfilePlugin("pr", options);
    reset();
    // A user's file where the plugin needs the skills/s47 folder.
    rmSync(join(folder, "skills"), { recursive: true, force: true });
    writeFileSync(join(folder, "skills"), "USER\n");

    const dry = await applyProfilePlugin("pr", { ...options, dryRun: true, planPluginFolders: true });
    const dryBlocked = takeBlockedHostPluginViewFiles();
    expect(takeKeptHostPluginViewFiles()).toEqual([]);
    expect(readFileSync(join(folder, "skills"), "utf8")).toBe("USER\n");

    expect(dryBlocked).toHaveLength(1);
    expect(dryBlocked[0]?.files.map((file) => file.path)).toEqual(["skills/s47/SKILL.md", "skills/s47/a.md"]);
    expect(dry.skipped_removals?.map((skip) => skip.path)).toEqual([".claude/plugins/cache/mkdry/p47/1.0.0/skills"]);

    await applyProfilePlugin("pr", options);
    const realBlocked = takeBlockedHostPluginViewFiles();
    expect(dryBlocked).toEqual(realBlocked);
    expect(readFileSync(join(folder, "skills"), "utf8")).toBe("USER\n");
  });

  it("counts the plugin folder files a first apply would write", async () => {
    const folder = setupProfile("mkfresh");
    // Seed the package cache and registration, then drop the plugin folder.
    await applyProfilePlugin("pr", options);
    reset();
    rmSync(folder, { recursive: true, force: true });

    const dry = await applyProfilePlugin("pr", { ...options, dryRun: true, planPluginFolders: true });
    const written = dry.written_files.filter((path) => path.startsWith(".claude/plugins/cache/mkfresh/p47/1.0.0/"));
    expect(written.sort()).toEqual([
      ".claude/plugins/cache/mkfresh/p47/1.0.0/.claude-plugin/plugin.json",
      ".claude/plugins/cache/mkfresh/p47/1.0.0/skills/s47/SKILL.md",
      ".claude/plugins/cache/mkfresh/p47/1.0.0/skills/s47/a.md",
    ]);
    expect(existsSync(folder)).toBe(false);
  });

  it("leaves the plugin folders out unless asked, as status and previews do", async () => {
    const folder = setupProfile("mkplain");
    await applyProfilePlugin("pr", options);
    reset();
    writeFileSync(join(folder, "skills/s47/a.md"), "mine\n");
    const dry = await applyProfilePlugin("pr", { ...options, dryRun: true });
    expect(dry.written_files.some((path) => path.includes("/cache/mkplain/"))).toBe(false);
    expect(takeBlockedHostPluginViewFiles()).toEqual([]);
    expect(takeKeptHostPluginViewFiles()).toEqual([]);
  });
});

describe("planHostPluginViewMirror", () => {
  const VIEW = ".claude/plugins/cache/mkp/pl/1.0.0";
  const MANIFEST = { ".claude-plugin/plugin.json": '{"name":"pl","version":"1.0.0"}\n' };
  function tree(files: Record<string, string>): string {
    const dir = createTempDir("plan-pkg");
    dirs.push(dir);
    for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
    return dir;
  }
  const input = (canonicalDir: string) => ({
    homeRoot: ctx.homeDir,
    marketplace: "mkp",
    pluginName: "pl",
    version: "1.0.0",
    canonicalDir,
  });

  it("plans a new folder without creating it", () => {
    const plan = planHostPluginViewMirror(input(tree({ ...MANIFEST, "skills/a/SKILL.md": "v1\n" })));
    expect(plan?.add.sort()).toEqual([".claude-plugin/plugin.json", "skills/a/SKILL.md"].sort());
    expect(existsSync(join(ctx.homeDir, VIEW))).toBe(false);
  });

  it("plans what the refresh then does, without changing anything", () => {
    mirrorHostPluginView(input(tree({ ...MANIFEST, "skills/a/SKILL.md": "v1\n", "skills/gone.md": "g\n" })));
    reset();
    writeFileSync(join(ctx.homeDir, VIEW, "notes.txt"), "mine\n");
    const next = tree({ ...MANIFEST, "skills/a/SKILL.md": "v2\n", "skills/b/SKILL.md": "new\n" });

    const plan = planHostPluginViewMirror(input(next));
    expect(plan?.add).toEqual(["skills/b/SKILL.md"]);
    expect(plan?.replace).toEqual(["skills/a/SKILL.md"]);
    expect(plan?.remove).toEqual(["skills/gone.md"]);
    expect(plan?.kept.map((file) => file.path)).toEqual(["notes.txt"]);
    expect(readFileSync(join(ctx.homeDir, VIEW, "skills/a/SKILL.md"), "utf8")).toBe("v1\n");
    expect(existsSync(join(ctx.homeDir, VIEW, "skills/gone.md"))).toBe(true);
    expect(takeReplacedHostPluginViewFiles()).toEqual([]);

    mirrorHostPluginView(input(next));
    expect(readFileSync(join(ctx.homeDir, VIEW, "skills/a/SKILL.md"), "utf8")).toBe("v2\n");
    expect(existsSync(join(ctx.homeDir, VIEW, "skills/gone.md"))).toBe(false);
    expect(readFileSync(join(ctx.homeDir, VIEW, "notes.txt"), "utf8")).toBe("mine\n");
  });

  it("names the blocked file and leaves an empty folder in the way alone", () => {
    mirrorHostPluginView(input(tree({ ...MANIFEST })));
    reset();
    writeFileSync(join(ctx.homeDir, VIEW, "extra"), "my notes\n");
    mkdirSync(join(ctx.homeDir, VIEW, "empty"));
    const plan = planHostPluginViewMirror(input(tree({ ...MANIFEST, "extra/x.md": "x\n", empty: "now a file\n" })));
    expect(plan?.blocked).toEqual([{ path: "extra/x.md", blockedBy: "extra", kind: "file" }]);
    expect(plan?.add).toEqual(["empty"]);
    expect(existsSync(join(ctx.homeDir, VIEW, "empty"))).toBe(true);
    expect(takeBlockedHostPluginViewFiles()).toEqual([]);
  });
});
