import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { keptFilesInLeftHostPluginFolders } from "../../src/services/global-profile-cleanup.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A version bump leaves the old plugin folder behind. HarnessTap removes what
// it wrote there; the user's own files stay and must be listed as kept.
const OLD = ".claude/plugins/cache/mk/p/1.0.0";
const NEW = ".claude/plugins/cache/mk/p/1.1.0";

let root: string;
beforeEach(() => {
  root = createTempDir("left-plugin-folder");
});
afterEach(() => {
  cleanupDir(root);
});

describe("files kept in a plugin folder left behind", () => {
  it("lists the user's files left in the old folder, links included, and nothing already reported", () => {
    writeTextFile(join(root, OLD, "user-notes.md"), "notes\n");
    writeTextFile(join(root, OLD, "skills/s/mine.md"), "mine\n");
    writeTextFile(join(root, OLD, "skills/s/a.md"), "a edited\n");
    symlinkSync("user-notes.md", join(root, OLD, "NOTES.md"));
    writeTextFile(join(root, NEW, "skills/s/SKILL.md"), "skill\n");
    const kept = keptFilesInLeftHostPluginFolders(
      root,
      [`${NEW}/skills/s/SKILL.md`],
      [`${OLD}/skills/s/SKILL.md`, `${OLD}/skills/s/a.md`],
      [`${OLD}/skills/s/SKILL.md`],
      [{ path: `${OLD}/skills/s/a.md`, reason: "modified", message: "m" }],
    );
    expect(kept.map((skip) => [skip.path, skip.reason])).toEqual([
      [`${OLD}/NOTES.md`, "unmanaged"],
      [`${OLD}/skills/s/mine.md`, "unmanaged"],
      [`${OLD}/user-notes.md`, "unmanaged"],
    ]);
    // HarnessTap never wrote them, so --force-remove would not remove them.
    expect(kept.every((skip) => skip.forceable === false)).toBe(true);
  });

  it("says nothing about a folder still in use or already gone", () => {
    writeTextFile(join(root, NEW, "mine.md"), "mine\n");
    expect(keptFilesInLeftHostPluginFolders(
      root,
      [`${NEW}/skills/s/SKILL.md`],
      [`${NEW}/skills/s/old.md`, `${OLD}/skills/s/SKILL.md`],
      [],
      [],
    )).toEqual([]);
  });
});
