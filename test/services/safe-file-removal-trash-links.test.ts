import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  applyTrashRoot,
  executeSafeFileRemovals,
  pruneApplyTrash,
  restoreSafeRemovalBackup,
} from "../../src/services/safe-file-removal.ts";

const ROOT = ".claude/plugins/cache/m/sym/1.0.1";

describe("removed links in the trash", () => {
  it("keeps a removed link as a link, for a dangling link and a link to a folder", async () => {
    const context = await createInitializedTestContext("trash-links");
    try {
      const base = join(context.homeDir, ROOT);
      const outside = join(context.homeDir, "outside-dir");
      mkdirSync(join(base, "skills"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "keep.txt"), "keep\n");
      symlinkSync("gone.md", join(base, "AGENTS.md"));
      symlinkSync(outside, join(base, "skills/linkdir"));
      const paths = [`${ROOT}/AGENTS.md`, `${ROOT}/skills/linkdir`];

      const result = executeSafeFileRemovals(context.homeDir, paths, {
        mode: "listed",
        applyId: "apply-links",
        snapshotId: "snap-links",
      });
      expect(result.removed).toEqual(paths);

      const dangling = join(applyTrashRoot(), "apply-links", ROOT, "AGENTS.md");
      expect(lstatSync(dangling).isSymbolicLink()).toBe(true);
      expect(readlinkSync(dangling)).toBe("gone.md");
      const dir = join(applyTrashRoot(), "apply-links", ROOT, "skills/linkdir");
      expect(lstatSync(dir).isSymbolicLink()).toBe(true);
      expect(readlinkSync(dir)).toBe(outside);

      // With the rows gone, the trash itself restores the links as links.
      getDb().prepare("DELETE FROM apply_removal_backups WHERE apply_id = ?").run("apply-links");
      const restored = restoreSafeRemovalBackup({ applyId: "apply-links", rootPath: context.homeDir });
      expect(restored.sort()).toEqual([...paths].sort());
      expect(lstatSync(join(base, "AGENTS.md")).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(base, "AGENTS.md"))).toBe("gone.md");
      expect(lstatSync(join(base, "skills/linkdir")).isSymbolicLink()).toBe(true);
      expect(readdirSync(outside)).toEqual(["keep.txt"]);
    } finally {
      await context.cleanup();
    }
  });

  it("restores links from their rows too, and never follows a link while pruning the trash", async () => {
    const context = await createInitializedTestContext("trash-links-prune");
    try {
      const base = join(context.homeDir, ROOT);
      const outside = join(context.homeDir, "outside-dir");
      mkdirSync(base, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "keep.txt"), "keep\n");
      symlinkSync(outside, join(base, "linkdir"));
      executeSafeFileRemovals(context.homeDir, [`${ROOT}/linkdir`], {
        mode: "listed",
        applyId: "apply-prune",
        snapshotId: "snap-prune",
      });
      const restored = restoreSafeRemovalBackup({ snapshotId: "snap-prune", rootPath: context.homeDir });
      expect(restored).toEqual([`${ROOT}/linkdir`]);
      expect(readlinkSync(join(base, "linkdir"))).toBe(outside);

      // Plain trash folders (no row pins them) past the newest ten are pruned.
      getDb().prepare("DELETE FROM apply_removal_backups WHERE apply_id = ?").run("apply-prune");
      for (let index = 0; index < 12; index += 1) {
        const dir = join(applyTrashRoot(), `old-${String(index).padStart(2, "0")}`);
        mkdirSync(dir, { recursive: true });
        symlinkSync(outside, join(dir, "link"));
        const when = new Date(Date.now() - (100 - index) * 1000);
        utimesSync(dir, when, when);
      }
      pruneApplyTrash();
      expect(existsSync(join(applyTrashRoot(), "old-00"))).toBe(false);
      expect(readFileSync(join(outside, "keep.txt"), "utf-8")).toBe("keep\n");
    } finally {
      await context.cleanup();
    }
  });
});
