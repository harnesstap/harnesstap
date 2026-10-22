import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mirrorHostPluginView,
  replaceKeptHostPluginViewFiles,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import {
  backUpAndRemoveHostPluginViewFiles,
  restoreHostPluginViewBackup,
} from "../../src/services/package-cache/host-plugin-view-backups.ts";
import { planHostPluginViewRemovals } from "../../src/services/package-cache/host-plugin-view-ownership.ts";
import { executeSafeFileRemovals } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// Every removal in a host plugin folder goes through one check: HarnessTap
// never removes a real folder or a file it did not write there, even with
// --force-remove.
const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";
const MANIFEST = { ".claude-plugin/plugin.json": '{"name":"dup","version":"1.0.0"}\n' };

let ctx: TestContext;
let dirs: string[] = [];
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-guard-");
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
  dirs = [];
});
afterEach(async () => {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function packageTree(files: Record<string, string>): string {
  const dir = createTempDir("host-view-guard-pkg");
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
  return dir;
}

function mirror(canonicalDir: string): void {
  mirrorHostPluginView({ homeRoot: ctx.homeDir, marketplace: "mkta", pluginName: "dup", version: "1.0.0", canonicalDir });
}

function view(path = ""): string {
  return join(ctx.homeDir, VIEW, path);
}

/** A tracked file the user turned into their own folder. */
function userFolderAtTrackedPath(): void {
  mirror(packageTree({ ...MANIFEST, "skills/old/SKILL.md": "old\n" }));
  const tracked = view("skills/old/SKILL.md");
  cleanupDir(tracked);
  mkdirSync(tracked, { recursive: true });
  writeFileSync(join(tracked, "mine.md"), "mine\n");
}

describe("planHostPluginViewRemovals", () => {
  it("refuses real folders and files HarnessTap did not write, and allows its own and missing files", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a\n", "skills/b/SKILL.md": "b\n" }));
    writeFileSync(view("skills/b/SKILL.md"), "edited\n");
    writeFileSync(view("notes.md"), "mine\n");

    const plan = planHostPluginViewRemovals({
      homeRoot: ctx.homeDir,
      hostView: view(),
      paths: ["skills/a/SKILL.md", "skills/b/SKILL.md", "notes.md", "skills", "gone.md"],
    });

    expect(plan.allowed).toEqual(["skills/a/SKILL.md", "skills/b/SKILL.md", "gone.md"]);
    expect(plan.refused).toEqual([
      { path: "notes.md", reason: "unmanaged" },
      { path: "skills", reason: "folder" },
    ]);
  });
});

describe("backUpAndRemoveHostPluginViewFiles", () => {
  it("never removes a folder or a file HarnessTap did not write, even when asked to", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a\n" }));
    writeFileSync(view("notes.md"), "mine\n");
    mkdirSync(view("mine"));
    writeFileSync(view("mine/x.md"), "x\n");

    const id = backUpAndRemoveHostPluginViewFiles({
      homeRoot: ctx.homeDir,
      hostView: view(),
      paths: ["skills/a/SKILL.md", "notes.md", "mine"],
    });

    expect(id).toBeDefined();
    expect(existsSync(view("skills/a/SKILL.md"))).toBe(false);
    expect(readFileSync(view("notes.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(view("mine/x.md"), "utf8")).toBe("x\n");
  });

  it("returns no backup id when every path is refused", () => {
    mirror(packageTree({ ...MANIFEST }));
    writeFileSync(view("notes.md"), "mine\n");
    expect(backUpAndRemoveHostPluginViewFiles({ homeRoot: ctx.homeDir, hostView: view(), paths: ["notes.md"] }))
      .toBeUndefined();
    expect(readFileSync(view("notes.md"), "utf8")).toBe("mine\n");
  });
});

describe("a refresh with --force-remove", () => {
  it("keeps files the user added and lists them as kept", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n" }));
    writeFileSync(view("notes.md"), "mine\n");
    writeFileSync(view("skills/a/extra.md"), "extra\n");
    setHostPluginViewForceReplace(true);

    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v2\n" }));

    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v2\n");
    expect(readFileSync(view("notes.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(view("skills/a/extra.md"), "utf8")).toBe("extra\n");
    expect(takeReplacedHostPluginViewFiles().map((entry) => entry.files)).toEqual([["skills/a/SKILL.md"]]);
    expect(takeKeptHostPluginViewFiles()[0]?.files).toEqual([
      { path: "notes.md", reason: "unmanaged", inPlugin: false },
      { path: "skills/a/extra.md", reason: "unmanaged", inPlugin: false },
    ]);
  });

  it("keeps a folder the user made at a path HarnessTap wrote", () => {
    userFolderAtTrackedPath();
    setHostPluginViewForceReplace(true);

    mirror(packageTree({ ...MANIFEST }));

    expect(readFileSync(view("skills/old/SKILL.md/mine.md"), "utf8")).toBe("mine\n");
  });
});

describe("replaceKeptHostPluginViewFiles", () => {
  it("replaces only files HarnessTap wrote that changed since", () => {
    const tree = packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a\n" });
    mirror(tree);
    writeFileSync(view("skills/a/SKILL.md"), "edited\n");
    writeFileSync(view("notes.md"), "mine\n");
    mirror(tree);
    const [entry] = takeKeptHostPluginViewFiles();
    if (!entry) throw new Error("expected kept files");

    const result = replaceKeptHostPluginViewFiles(entry);

    expect(result.paths).toEqual(["skills/a/SKILL.md"]);
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a\n");
    expect(readFileSync(view("notes.md"), "utf8")).toBe("mine\n");
  });
});

describe("switching away with --force-remove", () => {
  it("never removes a file the folder's record says HarnessTap did not write", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a\n" }));
    writeFileSync(view("notes.md"), "mine\n");

    const result = executeSafeFileRemovals(
      ctx.homeDir,
      [`${VIEW}/skills/a/SKILL.md`, `${VIEW}/notes.md`],
      { forceRemove: true },
    );

    expect(result.removed).toEqual([`${VIEW}/skills/a/SKILL.md`]);
    expect(result.skipped.map((entry) => entry.path)).toEqual([`${VIEW}/notes.md`]);
    expect(readFileSync(view("notes.md"), "utf8")).toBe("mine\n");
  });
});

describe("ht revert --force-remove of a host plugin folder backup", () => {
  it("never restores over a file the user put there since", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a\n" }));
    const id = backUpAndRemoveHostPluginViewFiles({ homeRoot: ctx.homeDir, hostView: view(), paths: ["skills/a/SKILL.md"] });
    if (!id) throw new Error("expected a backup id");
    writeTextFile(view("skills/a/SKILL.md"), "mine now\n");

    const result = restoreHostPluginViewBackup(id, { forceRemove: true });

    expect(result?.restored).toEqual([]);
    expect(result?.skipped).toEqual([{ path: "skills/a/SKILL.md", reason: "changed" }]);
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("mine now\n");
  });
});
