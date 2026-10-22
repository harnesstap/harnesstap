import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { announceBlocked, settleKeptHostPluginViewFiles } from "../../src/cli/handlers/host-plugin-view-kept.ts";
import {
  mirrorHostPluginView,
  setHostPluginViewForceReplace,
  takeBlockedHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import {
  backUpAndRemoveHostPluginViewFiles,
  restoreHostPluginViewBackup,
} from "../../src/services/package-cache/host-plugin-view-backups.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A user's file or folder in the way of a plugin file: the rest of the plugin
// is still written, the blocked paths are named, and the command fails.
// Revert says what is in the way, in a dry run too, and never writes through it.
const VIEW = ".claude/plugins/cache/mkb/blk/1.0.0";
const MANIFEST = { ".claude-plugin/plugin.json": '{"name":"blk","version":"1.0.0"}\n' };

let ctx: TestContext;
let dirs: string[] = [];
function reset(): void {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
  takeBlockedHostPluginViewFiles();
}
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-blocked-");
  reset();
  dirs = [];
});
afterEach(async () => {
  reset();
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function packageTree(files: Record<string, string>): string {
  const dir = createTempDir("host-view-blocked-pkg");
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
  return dir;
}
function mirror(files: Record<string, string>): void {
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "mkb",
    pluginName: "blk",
    version: "1.0.0",
    canonicalDir: packageTree(files),
  });
}
function view(path = ""): string {
  return join(ctx.homeDir, VIEW, path);
}

describe("host plugin refresh with a user's folder or file in the way", () => {
  it("writes the rest of the plugin, keeps the user's folder and names it", () => {
    mirror({ ...MANIFEST, "skills/a/SKILL.md": "v1\n" });
    rmSync(view(".claude-plugin/plugin.json"));
    mkdirSync(view(".claude-plugin/plugin.json"));
    writeFileSync(view(".claude-plugin/plugin.json/u.txt"), "mine\n");

    mirror({ ".claude-plugin/plugin.json": '{"name":"blk","version":"1.0.0","x":1}\n', "skills/a/SKILL.md": "v2\n", "skills/b/SKILL.md": "new\n" });

    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("v2\n");
    expect(readFileSync(view("skills/b/SKILL.md"), "utf8")).toBe("new\n");
    expect(readFileSync(view(".claude-plugin/plugin.json/u.txt"), "utf8")).toBe("mine\n");
    expect(takeBlockedHostPluginViewFiles()).toEqual([
      {
        hostView: view().replace(/\/$/, ""),
        files: [{ path: ".claude-plugin/plugin.json", blockedBy: ".claude-plugin/plugin.json", kind: "folder" }],
      },
    ]);
  });

  it("never writes through a user's file where the plugin needs a folder", () => {
    mirror({ ...MANIFEST });
    writeFileSync(view("extra"), "my notes\n");

    mirror({ ...MANIFEST, "extra/x.md": "x\n", "skills/b/SKILL.md": "new\n" });

    expect(readFileSync(view("extra"), "utf8")).toBe("my notes\n");
    expect(readFileSync(view("skills/b/SKILL.md"), "utf8")).toBe("new\n");
    expect(takeBlockedHostPluginViewFiles()[0]?.files).toEqual([
      { path: "extra/x.md", blockedBy: "extra", kind: "file" },
    ]);
  });

  it("reports nothing when nothing is in the way", () => {
    mirror({ ...MANIFEST, "skills/a/SKILL.md": "v1\n" });
    mirror({ ...MANIFEST, "skills/a/SKILL.md": "v2\n" });
    expect(takeBlockedHostPluginViewFiles()).toEqual([]);
  });

  it("names the blocked paths and fails the command", async () => {
    const entry = {
      hostView: view(),
      files: [
        { path: ".claude-plugin/plugin.json", blockedBy: ".claude-plugin/plugin.json", kind: "folder" as const },
        { path: "extra/x.md", blockedBy: "extra", kind: "file" as const },
      ],
    };
    const text = announceBlocked(entry);
    expect(text).toContain("Could not write 2 plugin files");
    expect(text).toContain(".claude-plugin/plugin.json (a folder is at that path)");
    expect(text).toContain("extra/x.md (extra is a file, where the plugin needs a folder)");
    expect(text).not.toMatch(/[\u2013\u2014]/);

    const before = process.exitCode;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.join(" "));
    try {
      await settleKeptHostPluginViewFiles({}, {
        interactive: false,
        confirm: async () => false,
        take: () => [],
        takeReplaced: () => [],
        replace: () => ({ paths: [] }),
        takeBlocked: () => [entry],
      });
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = original;
      process.exitCode = before;
    }
    expect(errors.join("\n")).toContain("Could not write 2 plugin files");
  });
});

describe("revert with a file where the backup needs a folder", () => {
  /** Back up dir/u.txt, then let the plugin write a file named dir. */
  function backupUnderNowAFile(): string {
    mirror({ ...MANIFEST, "dir/u.txt": "old\n" });
    const id = backUpAndRemoveHostPluginViewFiles({ homeRoot: ctx.homeDir, hostView: view().replace(/\/$/, ""), paths: ["dir/u.txt"] });
    expect(id).toBeDefined();
    mirror({ ...MANIFEST, dir: "now a file\n" });
    expect(takeBlockedHostPluginViewFiles()).toEqual([]);
    expect(readFileSync(view("dir"), "utf8")).toBe("now a file\n");
    return id as string;
  }

  it("says what is in the way without --force-remove, in a dry run and for real", () => {
    const id = backupUnderNowAFile();
    const expected = [{ path: "dir/u.txt", reason: "blocked", blockedBy: "dir", canForce: true }];
    const dry = restoreHostPluginViewBackup(id, { dryRun: true });
    expect(dry?.restored).toEqual([]);
    expect(dry?.skipped).toEqual(expected);
    const real = restoreHostPluginViewBackup(id);
    expect(real?.restored).toEqual([]);
    expect(real?.skipped).toEqual(expected);
    expect(readFileSync(view("dir"), "utf8")).toBe("now a file\n");
  });

  it("backs up HarnessTap's file in the way and restores with --force-remove", () => {
    const id = backupUnderNowAFile();
    const dry = restoreHostPluginViewBackup(id, { dryRun: true, forceRemove: true });
    expect(dry?.restored).toEqual(["dir/u.txt"]);
    expect(readFileSync(view("dir"), "utf8")).toBe("now a file\n");

    const real = restoreHostPluginViewBackup(id, { forceRemove: true });
    expect(real?.restored).toEqual(["dir/u.txt"]);
    expect(real?.replacedBackupId).toBeDefined();
    expect(readFileSync(view("dir/u.txt"), "utf8")).toBe("old\n");
  });

  it("never removes a user's file in the way, even with --force-remove", () => {
    mirror({ ...MANIFEST, "dir/u.txt": "old\n" });
    const id = backUpAndRemoveHostPluginViewFiles({ homeRoot: ctx.homeDir, hostView: view().replace(/\/$/, ""), paths: ["dir/u.txt"] });
    rmSync(view("dir"), { recursive: true, force: true });
    writeFileSync(view("dir"), "the user's own\n");
    const real = restoreHostPluginViewBackup(id as string, { forceRemove: true });
    expect(real?.restored).toEqual([]);
    expect(real?.skipped).toEqual([{ path: "dir/u.txt", reason: "blocked", blockedBy: "dir", canForce: false }]);
    expect(readFileSync(view("dir"), "utf8")).toBe("the user's own\n");
    expect(lstatSync(view("dir")).isFile()).toBe(true);
    expect(existsSync(view("dir/u.txt"))).toBe(false);
  });
});
