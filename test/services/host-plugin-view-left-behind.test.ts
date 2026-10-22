import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { planStaleGlobalProfileFiles } from "../../src/services/global-profile-cleanup.ts";
import { removeGlobalMaterializedFiles } from "../../src/services/applier.ts";
import {
  mirrorHostPluginView,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import { recordedHostPluginViewPaths } from "../../src/services/package-cache/host-plugin-views.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// After a profile switch or a version bump, the files HarnessTap wrote into
// the old host plugin folder go, links and plugin instruction files
// included, while anything changed or added by someone else stays.
const VIEW = ".claude/plugins/cache/mksym/sym/1.0.1";
// What an older apply listed: the link was never in it.
const OLD_MANIFEST = [
  `${VIEW}/CLAUDE.md`,
  `${VIEW}/skills/s1/SKILL.md`,
  `${VIEW}/.claude-plugin/plugin.json`,
];

let ctx: TestContext;
let dirs: string[] = [];
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-left-");
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  dirs = [];
});
afterEach(async () => {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function mirrorLinkedPlugin(): void {
  const dir = createTempDir("host-view-left-pkg");
  dirs.push(dir);
  writeTextFile(join(dir, ".claude-plugin/plugin.json"), '{"name":"sym","version":"1.0.1"}\n');
  writeTextFile(join(dir, "CLAUDE.md"), "claude\n");
  writeTextFile(join(dir, "skills/s1/SKILL.md"), "---\nname: s1\ndescription: s\n---\n");
  symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "mksym",
    pluginName: "sym",
    version: "1.0.1",
    canonicalDir: dir,
  });
}

function view(path = ""): string {
  return join(ctx.homeDir, VIEW, path);
}

function cleanup(desired: string[] = []) {
  const stale = planStaleGlobalProfileFiles(ctx.homeDir, desired, OLD_MANIFEST, ["claude-code"]);
  return { stale, result: removeGlobalMaterializedFiles(ctx.homeDir, stale) };
}

describe("files HarnessTap wrote into a host plugin folder left behind", () => {
  it("lists the links an install wrote in the manifest", () => {
    mirrorLinkedPlugin();
    expect(recordedHostPluginViewPaths(ctx.homeDir, [`${VIEW}/CLAUDE.md`]).sort()).toEqual(
      [...OLD_MANIFEST, `${VIEW}/AGENTS.md`].sort(),
    );
  });

  it("removes them with a backup, link and plugin CLAUDE.md included, then the empty folder", () => {
    mirrorLinkedPlugin();
    const { stale, result } = cleanup();
    expect(stale).toContain(`${VIEW}/AGENTS.md`);
    expect(stale).toContain(`${VIEW}/CLAUDE.md`);
    expect(result.skipped.filter((skip) => skip.reason !== "missing")).toEqual([]);
    expect(existsSync(join(ctx.homeDir, ".claude/plugins/cache/mksym"))).toBe(false);
    const backups = ctx.connection
      .getDb()
      .prepare("SELECT relative_path FROM apply_removal_backups WHERE apply_id = ?")
      .all(result.applyId) as { relative_path: string }[];
    expect(backups.map((row) => row.relative_path).sort()).toEqual(
      [...OLD_MANIFEST, `${VIEW}/AGENTS.md`].sort(),
    );
  });

  it("keeps a changed file, a relinked link and the user's own file, and lists the changed ones", () => {
    mirrorLinkedPlugin();
    writeTextFile(view("CLAUDE.md"), "claude\nmy edit\n");
    rmSync(view("AGENTS.md"));
    symlinkSync("skills/s1/SKILL.md", view("AGENTS.md"));
    writeTextFile(view("skills/s1/mine.md"), "mine\n");
    const { result } = cleanup();
    expect(result.removed.sort()).toEqual(
      [`${VIEW}/.claude-plugin/plugin.json`, `${VIEW}/skills/s1/SKILL.md`].sort(),
    );
    expect(result.skipped.filter((skip) => skip.reason === "modified").map((skip) => skip.path).sort())
      .toEqual([`${VIEW}/AGENTS.md`, `${VIEW}/CLAUDE.md`]);
    expect(readFileSync(view("CLAUDE.md"), "utf8")).toBe("claude\nmy edit\n");
    expect(lstatSync(view("AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readFileSync(view("skills/s1/mine.md"), "utf8")).toBe("mine\n");
  });

  it("leaves a folder still in use alone, links the apply never emits included", () => {
    mirrorLinkedPlugin();
    mkdirSync(view("skills/s1"), { recursive: true });
    const { stale } = cleanup([...OLD_MANIFEST]);
    expect(stale).toEqual([]);
    expect(lstatSync(view("AGENTS.md")).isSymbolicLink()).toBe(true);
  });
});
