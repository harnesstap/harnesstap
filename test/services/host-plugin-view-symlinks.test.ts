import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  ingestHostPluginTreeIntoCache,
  mirrorHostPluginView,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";
import { restoreSafeRemovalBackup } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// Plugins ship links (AGENTS.md -> CLAUDE.md, .opencode/skills -> ../skills).
// They must land as links with the same relative target, and a refresh must
// never follow a link into a folder outside the plugin folder.
const VIEW = ".claude/plugins/cache/mksym/sym/1.0.0";

let ctx: TestContext;
let dirs: string[] = [];
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-symlinks-");
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

function linkedPackage(): string {
  const dir = createTempDir("host-view-sym-pkg");
  dirs.push(dir);
  writeTextFile(join(dir, ".claude-plugin/plugin.json"), '{"name":"sym","version":"1.0.0"}\n');
  writeTextFile(join(dir, "CLAUDE.md"), "claude\n");
  writeTextFile(join(dir, "skills/s1/SKILL.md"), "---\nname: s1\ndescription: s\n---\n");
  symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  symlinkSync("../skills/", join(dir, ".opencode/skills"));
  return dir;
}

function mirror(canonicalDir: string): void {
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "mksym",
    pluginName: "sym",
    version: "1.0.0",
    canonicalDir,
  });
}

function view(path = ""): string {
  return join(ctx.homeDir, VIEW, path);
}

describe("host plugin folders with links", () => {
  it("writes links as links with their relative target, and a refresh leaves them alone", () => {
    const pkg = linkedPackage();
    mirror(pkg);
    expect(lstatSync(view("AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(view("AGENTS.md"))).toBe("CLAUDE.md");
    expect(readFileSync(view("AGENTS.md"), "utf8")).toBe("claude\n");
    expect(readlinkSync(view(".opencode/skills"))).toBe("../skills/");
    expect(existsSync(view(".opencode/skills/s1/SKILL.md"))).toBe(true);

    mirror(pkg);
    expect(takeKeptHostPluginViewFiles()).toEqual([]);
    expect(readlinkSync(view("AGENTS.md"))).toBe("CLAUDE.md");
  });

  it("copies links verbatim into the package cache and repairs links an older copy made absolute", () => {
    const pkg = linkedPackage();
    const canonical = ingestHostPluginTreeIntoCache({
      harnesstapDir: getHarnesstapDir(),
      homeRoot: ctx.homeDir,
      originRef: "sym@mksym",
      sourceInstallRoot: pkg,
      version: "1.0.0",
    });
    expect(canonical).toBe(hostPluginPackageDir(getHarnesstapDir(), "mksym", "sym", "1.0.0"));
    expect(readlinkSync(join(canonical, "AGENTS.md"))).toBe("CLAUDE.md");
    expect(readlinkSync(join(canonical, ".opencode/skills"))).toBe("../skills/");

    // An older copy pointed the link at a scratch checkout deleted since.
    rmSync(join(canonical, "AGENTS.md"));
    symlinkSync("/nonexistent/ht-plugin-history-x/tree/CLAUDE.md", join(canonical, "AGENTS.md"));
    ingestHostPluginTreeIntoCache({
      harnesstapDir: getHarnesstapDir(),
      homeRoot: ctx.homeDir,
      originRef: "sym@mksym",
      sourceInstallRoot: pkg,
      version: "1.0.0",
    });
    expect(readlinkSync(join(canonical, "AGENTS.md"))).toBe("CLAUDE.md");
    expect(readlinkSync(view("AGENTS.md"))).toBe("CLAUDE.md");
  });

  it("backs up a link it replaces so it can be put back as a link", () => {
    const pkg = linkedPackage();
    mirror(pkg);
    rmSync(join(pkg, "AGENTS.md"));
    symlinkSync("skills/s1/SKILL.md", join(pkg, "AGENTS.md"));
    mirror(pkg);
    expect(readlinkSync(view("AGENTS.md"))).toBe("skills/s1/SKILL.md");

    rmSync(view("AGENTS.md"));
    const [backup] = ctx.connection
      .getDb()
      .prepare("SELECT apply_id, mode FROM apply_removal_backups WHERE relative_path = ?")
      .all(`${VIEW}/AGENTS.md`) as { apply_id: string; mode: number }[];
    expect(backup).toBeDefined();
    const restored = restoreSafeRemovalBackup({ applyId: backup?.apply_id, rootPath: ctx.homeDir });
    expect(restored).toContain(`${VIEW}/AGENTS.md`);
    expect(readlinkSync(view("AGENTS.md"))).toBe("CLAUDE.md");
  });

  it("keeps a link the user added, and never prunes folders behind a link", () => {
    const pkg = linkedPackage();
    mirror(pkg);
    const outside = createTempDir("host-view-sym-outside");
    dirs.push(outside);
    mkdirSync(join(outside, "empty"), { recursive: true });
    symlinkSync(outside, view("mine"));
    mirror(pkg);
    expect(lstatSync(view("mine")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(outside, "empty"))).toBe(true);
    expect(takeKeptHostPluginViewFiles().flatMap((entry) => entry.files.map((file) => file.path))).toEqual(["mine"]);
  });
});
