import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { refreshCachedHostPluginVersion } from "../../src/services/package-cache/host-plugin-refresh.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const MANIFEST = '{"name":"p47","version":"1.0.0"}\n';

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) cleanupDir(dir);
  dirs = [];
});

function tree(files: Record<string, string>): string {
  const root = createTempDir("ht-refresh-src-");
  dirs.push(root);
  writeTextFile(join(root, ".claude-plugin", "plugin.json"), MANIFEST);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(root, path), content);
  return root;
}

function cached(harnesstapDir: string, files: Record<string, string>): string {
  const dir = hostPluginPackageDir(harnesstapDir, "mk547", "p47", "1.0.0");
  writeTextFile(join(dir, ".claude-plugin", "plugin.json"), MANIFEST);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
  return dir;
}

function htDir(): string {
  const dir = createTempDir("ht-refresh-ht-");
  dirs.push(dir);
  return dir;
}

describe("refreshCachedHostPluginVersion", () => {
  it("refreshes the cached copy when the marketplace changed a plugin without a version bump", () => {
    const harnesstapDir = htDir();
    const dir = cached(harnesstapDir, { "skills/s/c.md": "c v2\n", "skills/s/gone.md": "x\n" });
    const source = tree({ "skills/s/c.md": "c v3\n", "skills/s/d.md": "d v3\n" });
    symlinkSync("c.md", join(source, "skills/s/link.md"));

    const refreshed = refreshCachedHostPluginVersion({
      harnesstapDir,
      originRef: "p47@mk547",
      version: "1.0.0",
      sourceInstallRoot: source,
    });

    expect(refreshed).toBe(true);
    expect(readFileSync(join(dir, "skills/s/c.md"), "utf8")).toBe("c v3\n");
    expect(readFileSync(join(dir, "skills/s/d.md"), "utf8")).toBe("d v3\n");
    expect(existsSync(join(dir, "skills/s/gone.md"))).toBe(false);
    expect(readlinkSync(join(dir, "skills/s/link.md"))).toBe("c.md");
  });

  it("leaves an identical cached copy alone", () => {
    const harnesstapDir = htDir();
    cached(harnesstapDir, { "skills/s/c.md": "c v2\n" });
    const source = tree({ "skills/s/c.md": "c v2\n" });
    expect(
      refreshCachedHostPluginVersion({
        harnesstapDir,
        originRef: "p47@mk547",
        version: "1.0.0",
        sourceInstallRoot: source,
      }),
    ).toBe(false);
  });

  it("does nothing when that version was never cached", () => {
    const harnesstapDir = htDir();
    const source = tree({ "skills/s/c.md": "c v3\n" });
    expect(
      refreshCachedHostPluginVersion({
        harnesstapDir,
        originRef: "p47@mk547",
        version: "1.0.0",
        sourceInstallRoot: source,
      }),
    ).toBe(false);
    expect(existsSync(hostPluginPackageDir(harnesstapDir, "mk547", "p47", "1.0.0"))).toBe(false);
  });
});
