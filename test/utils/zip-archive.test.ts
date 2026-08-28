import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BundleSymlinkError, listContainedRegularFiles } from "../../src/utils/path-containment.ts";
import { readZipArchive, writeZipArchive, ZipSymlinkError } from "../../src/utils/zip-archive.ts";

describe("writeZipArchive / readZipArchive", () => {
  it("round-trips files at the archive root", () => {
    const archive = writeZipArchive([
      { path: "plugin.json", data: Buffer.from('{"name":"demo"}', "utf8") },
      { path: "skills/ship/SKILL.md", data: Buffer.from("# Ship\n", "utf8") },
    ]);
    const files = readZipArchive(archive);
    expect(files.map((file) => file.path).sort()).toEqual([
      "plugin.json",
      "skills/ship/SKILL.md",
    ]);
    expect(files.find((file) => file.path === "plugin.json")?.data.toString("utf8")).toBe(
      '{"name":"demo"}',
    );
  });

  it("strips a single wrapping root directory when plugin.json is inside it", () => {
    const archive = writeZipArchive([
      { path: "demo/plugin.json", data: Buffer.from("{}", "utf8") },
      { path: "demo/skills/a/SKILL.md", data: Buffer.from("a", "utf8") },
    ]);
    expect(readZipArchive(archive).map((file) => file.path).sort()).toEqual([
      "plugin.json",
      "skills/a/SKILL.md",
    ]);
  });

  it("rejects path-traversal members", () => {
    expect(() =>
      writeZipArchive([{ path: "../escape.txt", data: Buffer.from("x") }]),
    ).toThrow(/Path escapes/);
  });
});

describe("listContainedRegularFiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "regular-files-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists regular files and rejects symlinks", () => {
    mkdirSync(join(root, "skills", "ship"), { recursive: true });
    writeFileSync(join(root, "skills", "ship", "SKILL.md"), "# Ship\n");
    expect(listContainedRegularFiles(root)).toEqual(["skills/ship/SKILL.md"]);

    symlinkSync(join(root, "skills", "ship", "SKILL.md"), join(root, "link.md"));
    expect(() => listContainedRegularFiles(root)).toThrow(BundleSymlinkError);
  });
});

describe("ZipSymlinkError", () => {
  it("names the class for consumers", () => {
    const error = new ZipSymlinkError("hooks/run");
    expect(error.entry).toBe("hooks/run");
    expect(error.name).toBe("ZipSymlinkError");
  });
});
