import * as fs from "node:fs";
import { lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { applyTrashRoot, executeSafeFileRemovals } from "../../src/services/safe-file-removal.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import {
  backUpAndRemoveHostPluginViewFiles,
  isHostPluginViewBackupId,
} from "../../src/services/package-cache/host-plugin-view-backups.ts";

const realRmSync = fs.rmSync;

/**
 * Node's rmSync follows links (Bun's does not): a link to a folder throws
 * EISDIR and a link whose target is gone is left as is, without an error.
 */
function rmSyncLikeNode(path: fs.PathLike, options?: fs.RmOptions): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch (error) {
    if (options?.force && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isDirectory() && !options?.recursive) {
    throw Object.assign(new Error(`Path is a directory: ${String(path)}`), { code: "ERR_FS_EISDIR" });
  }
  realRmSync(path, options);
}

function onDisk(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

describe("safe file removal of links", () => {
  let rmSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    rmSpy = spyOn(fs, "rmSync").mockImplementation(rmSyncLikeNode as typeof fs.rmSync);
  });
  afterEach(() => {
    rmSpy.mockRestore();
  });

  it("removes links a plugin shipped, even once their target is gone, and only once", async () => {
    const context = await createInitializedTestContext("safe-remove-links");
    try {
      const root = ".claude/plugins/cache/m/sym/1.0.1";
      const base = join(context.homeDir, root);
      mkdirSync(join(base, "skills/s1"), { recursive: true });
      mkdirSync(join(base, ".opencode"), { recursive: true });
      writeFileSync(join(base, "CLAUDE.md"), "c\n");
      writeFileSync(join(base, "skills/s1/SKILL.md"), "s\n");
      symlinkSync("CLAUDE.md", join(base, "AGENTS.md"));
      symlinkSync("../skills", join(base, ".opencode/skills"));
      const paths = [
        `${root}/CLAUDE.md`,
        `${root}/skills/s1/SKILL.md`,
        `${root}/AGENTS.md`,
        `${root}/.opencode/skills`,
      ];

      const first = executeSafeFileRemovals(context.homeDir, paths, { mode: "listed" });

      expect(first.removed).toEqual(paths);
      expect(onDisk(join(base, "AGENTS.md"))).toBe(false);
      expect(onDisk(join(base, ".opencode/skills"))).toBe(false);

      const again = executeSafeFileRemovals(context.homeDir, paths, { mode: "listed" });
      expect(again.removed).toEqual([]);
      expect(again.skipped.map((entry) => entry.reason)).toEqual(["missing", "missing", "missing", "missing"]);
    } finally {
      await context.cleanup();
    }
  });

  it("removes a link to a folder without touching the folder", async () => {
    const context = await createInitializedTestContext("safe-remove-dir-link");
    try {
      const root = ".claude/plugins/cache/m/sym/1.0.1";
      const base = join(context.homeDir, root);
      const outside = join(context.homeDir, "outside");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "x.md"), "x\n");
      mkdirSync(join(base, "skills/s47"), { recursive: true });
      symlinkSync(outside, join(base, "skills/s47/linkdir"));

      const result = executeSafeFileRemovals(context.homeDir, [`${root}/skills/s47/linkdir`], {
        mode: "listed",
      });

      expect(result.removed).toEqual([`${root}/skills/s47/linkdir`]);
      expect(onDisk(join(base, "skills/s47/linkdir"))).toBe(false);
      expect(readdirSync(outside)).toEqual(["x.md"]);
    } finally {
      await context.cleanup();
    }
  });
});

describe("host plugin folder backups", () => {
  it("gives every trash entry an id ht revert takes, even when a removal fails midway", async () => {
    const context = await createInitializedTestContext("host-view-backup-id");
    const canonicalDir = join(context.homeDir, "pkg");
    mkdirSync(join(canonicalDir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(canonicalDir, ".claude-plugin/plugin.json"), '{"name":"p","version":"1.0.0"}\n');
    writeFileSync(join(canonicalDir, "a.md"), "a\n");
    // HarnessTap writes the folder, so a.md is its own and may be removed.
    mirrorHostPluginView({ homeRoot: context.homeDir, marketplace: "m", pluginName: "p", version: "1.0.0", canonicalDir });
    const unlinkSpy = spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    });
    try {
      const hostView = join(context.homeDir, ".claude/plugins/cache/m/p/1.0.0");

      expect(() =>
        backUpAndRemoveHostPluginViewFiles({ homeRoot: context.homeDir, hostView, paths: ["a.md"] }),
      ).toThrow("EACCES");

      const trashIds = readdirSync(applyTrashRoot());
      expect(trashIds).toHaveLength(1);
      expect(isHostPluginViewBackupId(trashIds[0]!)).toBe(true);
    } finally {
      unlinkSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("records no id when there was nothing to remove", async () => {
    const context = await createInitializedTestContext("host-view-backup-none");
    try {
      const hostView = join(context.homeDir, ".claude/plugins/cache/m/p/1.0.0");
      mkdirSync(hostView, { recursive: true });

      const id = backUpAndRemoveHostPluginViewFiles({
        homeRoot: context.homeDir,
        hostView,
        paths: ["gone.md"],
      });

      expect(id).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
