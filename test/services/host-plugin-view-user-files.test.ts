import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { emitHostPluginTrees } from "../../src/services/host-plugin-serialize.ts";
import {
  mirrorHostPluginView,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import {
  isHostPluginViewBackupId,
  restoreHostPluginViewBackup,
} from "../../src/services/package-cache/host-plugin-view-backups.ts";
import {
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
  hashOnDiskFile,
} from "../../src/services/safe-file-removal.ts";
import type { Resource } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

// Files the user adds to or edits in a host plugin folder HarnessTap created
// stay theirs: an apply never records them as HarnessTap's, and a refresh,
// a version bump or a profile switch never removes them without saying so.
const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";
const MANIFEST = { ".claude-plugin/plugin.json": '{"name":"dup","version":"1.0.0"}\n' };

let ctx: TestContext;
let dirs: string[] = [];
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-user-files-");
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
  const dir = createTempDir("host-view-pkg");
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
  return dir;
}

function mirror(canonicalDir: string): void {
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "mkta",
    pluginName: "dup",
    version: "1.0.0",
    canonicalDir,
  });
}

function view(path = ""): string {
  return join(ctx.homeDir, VIEW, path);
}

function pin(): Resource {
  return makeResource({
    type: "plugin",
    name: "dup",
    namespace: "mkta",
    origin_kind: "marketplace_link",
    origin_ref: "dup@mkta",
    content: "{}",
    metadata: { source_kind: "marketplace", marketplace_name: "mkta", resolved_version: "1.0.0" },
  });
}

/** What an earlier apply recorded when it adopted every file in the folder. */
function adoptedRow(path: string): void {
  const resource = createResource({ type: "plugin", name: "dup", description: "", content: "{}", metadata: {}, source: "manual" });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "global",
    root_path: ctx.homeDir,
    platform_id: "claude-code",
    path: `${VIEW}/${path}`,
    action: "delete-file",
    ownership_key: "plugin:dup@mkta",
    generated_hash: hashOnDiskFile(view(path)) ?? "",
  });
}

function userEdits(): void {
  writeFileSync(view("skills/a/SKILL.md"), "a v1\nUSER EDIT\n");
  writeTextFile(view("user-notes.md"), "my notes\n");
  writeTextFile(view("skills/a/mine.md"), "mine\n");
}

describe("an apply over a host plugin folder HarnessTap created", () => {
  it("emits only the files HarnessTap wrote there, never the user's", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n" }));
    userEdits();
    const paths = emitHostPluginTrees([pin()], { layout: "claude-code", homeRoot: ctx.homeDir })
      .map((file) => file.path)
      .filter((path) => path.startsWith(VIEW));
    expect(paths.sort()).toEqual([`${VIEW}/.claude-plugin/plugin.json`, `${VIEW}/skills/a/SKILL.md`]);
  });

  it("calls the user's files theirs even when an earlier apply recorded them", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n" }));
    userEdits();
    for (const path of ["skills/a/SKILL.md", "user-notes.md", "skills/a/mine.md"]) adoptedRow(path);

    expect(classifyManagedPathOwnership(ctx.homeDir, `${VIEW}/user-notes.md`)).toBe("unowned");
    expect(classifyManagedPathOwnership(ctx.homeDir, `${VIEW}/skills/a/mine.md`)).toBe("unowned");
    expect(classifyManagedPathOwnership(ctx.homeDir, `${VIEW}/skills/a/SKILL.md`)).toBe("modified");
  });
});

describe("refreshing a host plugin folder the user added files to", () => {
  it("keeps them even when an earlier apply recorded them, and lands the new content", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n", "skills/b/SKILL.md": "b v1\n" }));
    userEdits();
    for (const path of ["skills/a/SKILL.md", "user-notes.md", "skills/a/mine.md"]) adoptedRow(path);

    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v2\n", "skills/b/SKILL.md": "b v2\n" }));

    expect(readFileSync(view("user-notes.md"), "utf8")).toBe("my notes\n");
    expect(readFileSync(view("skills/a/mine.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v1\nUSER EDIT\n");
    expect(readFileSync(view("skills/b/SKILL.md"), "utf8")).toBe("b v2\n");
    const [kept] = takeKeptHostPluginViewFiles();
    expect(kept?.files).toEqual([
      { path: "skills/a/SKILL.md", reason: "modified", inPlugin: true },
      { path: "skills/a/mine.md", reason: "unmanaged", inPlugin: false },
      { path: "user-notes.md", reason: "unmanaged", inPlugin: false },
    ]);
    const [replaced] = takeReplacedHostPluginViewFiles();
    expect(replaced?.files).toEqual(["skills/b/SKILL.md"]);
    expect(replaced?.notWrittenByHarnessTap).toEqual([]);
  });

  it("says what --force-remove replaced, never touches files HarnessTap did not write, and ht revert puts it back", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n" }));
    userEdits();
    setHostPluginViewForceReplace(true);

    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v2\n" }));

    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v2\n");
    expect(readFileSync(view("user-notes.md"), "utf8")).toBe("my notes\n");
    expect(readFileSync(view("skills/a/mine.md"), "utf8")).toBe("mine\n");
    const [replaced] = takeReplacedHostPluginViewFiles();
    if (!replaced) throw new Error("expected a replaced notice");
    expect(replaced.files).toEqual(["skills/a/SKILL.md"]);
    expect(replaced.removed).toEqual([]);
    expect(replaced.notWrittenByHarnessTap).toEqual(["skills/a/SKILL.md"]);
    expect(isHostPluginViewBackupId(replaced.backupId)).toBe(true);
    expect(takeKeptHostPluginViewFiles()[0]?.files).toEqual([
      { path: "skills/a/mine.md", reason: "unmanaged", inPlugin: false },
      { path: "user-notes.md", reason: "unmanaged", inPlugin: false },
    ]);

    // What is there now is exactly what HarnessTap wrote, so the printed
    // revert id puts the user's version back without --force-remove.
    const reverted = restoreHostPluginViewBackup(replaced.backupId);
    expect(reverted?.skipped).toEqual([]);
    expect(reverted?.restored).toEqual(["skills/a/SKILL.md"]);
    expect(reverted?.replacedBackupId).toBeDefined();
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v1\nUSER EDIT\n");

    // Restored files are the user's again: the next refresh keeps them.
    setHostPluginViewForceReplace(false);
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v3\n" }));
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v1\nUSER EDIT\n");
    expect(readFileSync(view("user-notes.md"), "utf8")).toBe("my notes\n");
  });
});

describe("switching away from a plugin whose folder the user changed", () => {
  it("removes only HarnessTap's unchanged files, even when an earlier apply recorded the user's", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n", "skills/b/SKILL.md": "b\n" }));
    userEdits();
    const paths = [".claude-plugin/plugin.json", "skills/a/SKILL.md", "skills/b/SKILL.md", "user-notes.md", "skills/a/mine.md"];
    for (const path of paths) adoptedRow(path);

    const removal = executeSafeFileRemovals(ctx.homeDir, paths.map((path) => `${VIEW}/${path}`));

    expect(removal.removed.sort()).toEqual([`${VIEW}/.claude-plugin/plugin.json`, `${VIEW}/skills/b/SKILL.md`]);
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v1\nUSER EDIT\n");
    expect(readFileSync(view("user-notes.md"), "utf8")).toBe("my notes\n");
    expect(readFileSync(view("skills/a/mine.md"), "utf8")).toBe("mine\n");
  });
});
