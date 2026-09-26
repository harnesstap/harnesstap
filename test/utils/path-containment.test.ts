import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PathEscapeError,
  assertArchiveMembersContained,
  assertContainedPath,
  isContainedPath,
  listContainedFiles,
  listContainedFilesPage,
} from "../../src/utils/path-containment.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "contain-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("assertContainedPath", () => {
  it("accepts a plain relative path", () => {
    expect(() => assertContainedPath(root, "skills/deploy/SKILL.md")).not.toThrow();
  });

  it("accepts names that begin with dots but are not parent traversal", () => {
    expect(() => assertContainedPath(root, "..foo")).not.toThrow();
    expect(() => assertContainedPath(root, "...")).not.toThrow();
    expect(() => assertContainedPath(root, "skills/..foo/SKILL.md")).not.toThrow();
  });

  it("rejects a parent traversal", () => {
    expect(() => assertContainedPath(root, "../escape.md")).toThrow(PathEscapeError);
    expect(() => assertContainedPath(root, "skills/../../escape.md")).toThrow(PathEscapeError);
    expect(() => assertContainedPath(root, "skills/../escape.md")).toThrow(PathEscapeError);
  });

  it("rejects an absolute path", () => {
    expect(() => assertContainedPath(root, "/etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects a sibling whose prefix only looks contained", () => {
    const sibling = `../${root.split("/").pop()}-evil/x`;
    expect(() => assertContainedPath(root, sibling)).toThrow(PathEscapeError);
  });

  it("names the offending entry in the message", () => {
    try {
      assertContainedPath(root, "../escape.md");
      throw new Error("expected assertContainedPath to throw");
    } catch (err) {
      expect((err as Error).message).toContain("../escape.md");
    }
  });
});

describe("listContainedFiles", () => {
  it("walks a tree and returns relative POSIX paths", () => {
    mkdirSync(join(root, "skills", "deploy"), { recursive: true });
    writeFileSync(join(root, "plugin.json"), "{}");
    writeFileSync(join(root, "skills", "deploy", "SKILL.md"), "# x");
    expect(listContainedFiles(root).sort()).toEqual([
      "plugin.json",
      "skills/deploy/SKILL.md",
    ]);
  });

  it("rejects a symlink that escapes the root", () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.txt"), "s");
    symlinkSync(outside, join(root, "leak"));
    expect(() => listContainedFiles(root)).toThrow(PathEscapeError);
    rmSync(outside, { recursive: true, force: true });
  });

  it("allows a symlink that stays inside the root", () => {
    mkdirSync(join(root, "real"), { recursive: true });
    writeFileSync(join(root, "real", "a.md"), "a");
    symlinkSync(join(root, "real"), join(root, "alias"));
    expect(() => listContainedFiles(root)).not.toThrow();
  });

  it("terminates on a symlink cycle", () => {
    mkdirSync(join(root, "a"), { recursive: true });
    symlinkSync(root, join(root, "a", "loop"));
    expect(() => listContainedFiles(root)).not.toThrow();
  });

  it("allows file names that begin with dots but are not parent traversal", () => {
    writeFileSync(join(root, "..foo"), "x");
    writeFileSync(join(root, "..."), "y");
    expect(listContainedFiles(root).sort()).toEqual(["...", "..foo"]);
  });

  it("pages files and stops walking after the requested limit", () => {
    mkdirSync(join(root, "skills"), { recursive: true });
    writeFileSync(join(root, "plugin.json"), "{}");
    writeFileSync(join(root, "skills", "a.md"), "a");
    writeFileSync(join(root, "skills", "b.md"), "b");
    const first = listContainedFilesPage(root, { limit: 2 });
    expect(first.files).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const rest = listContainedFilesPage(root, { offset: 2 });
    expect(rest.files).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
    expect([...first.files, ...rest.files].sort()).toEqual(
      listContainedFiles(root).sort(),
    );
  });

  it("does not descend skipped directory names", () => {
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "keep.md"), "k");
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x");
    const page = listContainedFilesPage(root, {
      skipDirNames: new Set(["node_modules"]),
    });
    expect(page.files).toEqual(["keep.md"]);
    expect(page.hasMore).toBe(false);
  });
});

describe("isContainedPath", () => {
  it("returns a boolean rather than throwing", () => {
    expect(isContainedPath(root, "a/b")).toBe(true);
    expect(isContainedPath(root, "../b")).toBe(false);
    expect(isContainedPath(root, "skills/../b")).toBe(false);
  });

  it("does not treat ..foo or ... as escapes", () => {
    expect(isContainedPath(root, "..foo")).toBe(true);
    expect(isContainedPath(root, "...")).toBe(true);
  });
});

describe("assertArchiveMembersContained", () => {
  it("rejects parent and absolute members before extract", () => {
    expect(() => assertArchiveMembersContained(root, ["../escape.md"])).toThrow(PathEscapeError);
    expect(() => assertArchiveMembersContained(root, ["foo/../../escape.md"])).toThrow(
      PathEscapeError,
    );
    expect(() => assertArchiveMembersContained(root, ["foo/../bar.md"])).toThrow(PathEscapeError);
    expect(() => assertArchiveMembersContained(root, ["/etc/passwd"])).toThrow(PathEscapeError);
  });

  it("allows contained members and directory markers", () => {
    expect(() =>
      assertArchiveMembersContained(root, [".", "./plugin.json", "skills/", "skills/plan/SKILL.md"]),
    ).not.toThrow();
  });

  it("allows ..foo member names", () => {
    expect(() => assertArchiveMembersContained(root, ["..foo", ".../x"])).not.toThrow();
  });
});
