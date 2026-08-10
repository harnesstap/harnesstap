import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PathEscapeError,
  assertContainedPath,
  isContainedPath,
  listContainedFiles,
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

  it("rejects a parent traversal", () => {
    expect(() => assertContainedPath(root, "../escape.md")).toThrow(PathEscapeError);
    expect(() => assertContainedPath(root, "skills/../../escape.md")).toThrow(PathEscapeError);
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
});

describe("isContainedPath", () => {
  it("returns a boolean rather than throwing", () => {
    expect(isContainedPath(root, "a/b")).toBe(true);
    expect(isContainedPath(root, "../b")).toBe(false);
  });
});
