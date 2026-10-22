import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import {
  applyTrashRoot,
  executeSafeFileRemovals,
  pruneApplyTrash,
  restoreSafeRemovalBackup,
} from "../../src/services/safe-file-removal.ts";

function seedOwned(context: TestContext, relative: string, content: string, hashOf = content): void {
  const full = join(context.homeDir, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
  const resource = createResource({
    type: "skill",
    name: relative.replace(/[^a-z0-9]/gi, "-"),
    description: "",
    content: hashOf,
    metadata: {},
    source: "manual",
  });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "global",
    root_path: context.homeDir,
    platform_id: "claude-code",
    path: relative,
    action: "delete-file",
    ownership_key: `skill:${resource.name}`,
    generated_hash: hashGeneratedContent(hashOf),
  });
}

interface BackupRow {
  relative_path: string;
  in_trash: number;
  blob_bytes: number;
}

function backupRows(applyId: string): BackupRow[] {
  return getDb()
    .prepare(
      `SELECT relative_path, in_trash, length(content) AS blob_bytes
       FROM apply_removal_backups WHERE apply_id = ? ORDER BY relative_path`,
    )
    .all(applyId) as BackupRow[];
}

describe("removal backups cost no copy of an unchanged file", () => {
  it("moves a file HarnessTap wrote into the trash, keeps no bytes in the database, and puts it back", async () => {
    const context = await createInitializedTestContext("trash-move-backup");
    try {
      const relative = ".claude/plugins/cache/m/p/1.0.0/skills/a/SKILL.md";
      const content = "# A\nbody line\n";
      seedOwned(context, relative, content);
      const full = join(context.homeDir, relative);

      const result = executeSafeFileRemovals(context.homeDir, [relative], {
        applyId: "apply-move",
        snapshotId: "snap-move",
      });

      expect(result.removed).toEqual([relative]);
      expect(existsSync(full)).toBe(false);
      const trashFile = join(applyTrashRoot(), "apply-move", ...relative.split("/"));
      expect(readFileSync(trashFile, "utf-8")).toBe(content);
      expect(backupRows("apply-move")).toEqual([{ relative_path: relative, in_trash: 1, blob_bytes: 0 }]);

      const restored = restoreSafeRemovalBackup({ snapshotId: "snap-move", rootPath: context.homeDir });
      expect(restored).toEqual([relative]);
      expect(readFileSync(full, "utf-8")).toBe(content);
      // The trash keeps its copy, so the same undo works again.
      expect(existsSync(trashFile)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps a full copy in the database for a file the user changed and --force-remove took", async () => {
    const context = await createInitializedTestContext("trash-forced-backup");
    try {
      const relative = ".claude/skills/edited/SKILL.md";
      seedOwned(context, relative, "# written\n");
      const full = join(context.homeDir, relative);
      writeFileSync(full, "# my own edit\n", "utf-8");

      const result = executeSafeFileRemovals(context.homeDir, [relative], {
        applyId: "apply-forced",
        forceRemove: true,
      });

      expect(result.forced?.map((entry) => entry.path)).toEqual([relative]);
      expect(backupRows("apply-forced")).toEqual([
        { relative_path: relative, in_trash: 0, blob_bytes: Buffer.byteLength("# my own edit\n") },
      ]);
      restoreSafeRemovalBackup({ applyId: "apply-forced", rootPath: context.homeDir });
      expect(readFileSync(full, "utf-8")).toBe("# my own edit\n");
    } finally {
      await context.cleanup();
    }
  });

  it("copies and removes when the trash is on another filesystem", async () => {
    const context = await createInitializedTestContext("trash-exdev-backup");
    const relative = ".claude/skills/x/SKILL.md";
    seedOwned(context, relative, "# x\n");
    const renameSpy = spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    });
    try {
      executeSafeFileRemovals(context.homeDir, [relative], { applyId: "apply-exdev", snapshotId: "snap-exdev" });
    } finally {
      renameSpy.mockRestore();
    }
    try {
      expect(existsSync(join(context.homeDir, relative))).toBe(false);
      expect(backupRows("apply-exdev")).toEqual([{ relative_path: relative, in_trash: 1, blob_bytes: 0 }]);
      restoreSafeRemovalBackup({ snapshotId: "snap-exdev", rootPath: context.homeDir });
      expect(readFileSync(join(context.homeDir, relative), "utf-8")).toBe("# x\n");
    } finally {
      await context.cleanup();
    }
  });

  it("never overwrites a trash file that backs an earlier row", async () => {
    const context = await createInitializedTestContext("trash-no-overwrite");
    try {
      const relative = ".claude/skills/dup/SKILL.md";
      seedOwned(context, relative, "first\n");
      executeSafeFileRemovals(context.homeDir, [relative], { applyId: "apply-dup" });
      mkdirSync(join(context.homeDir, relative, ".."), { recursive: true });
      writeFileSync(join(context.homeDir, relative), "second\n", "utf-8");
      executeSafeFileRemovals(context.homeDir, [relative], { applyId: "apply-dup", forceRemove: true });

      const trashFile = join(applyTrashRoot(), "apply-dup", ...relative.split("/"));
      expect(readFileSync(trashFile, "utf-8")).toBe("first\n");
      const rows = backupRows("apply-dup");
      expect(rows.map((row) => row.in_trash).sort()).toEqual([0, 1]);
      expect(rows.find((row) => row.in_trash === 0)?.blob_bytes).toBe(Buffer.byteLength("second\n"));
    } finally {
      await context.cleanup();
    }
  });
});

describe("pruning the apply trash", () => {
  it("keeps every folder that holds the only copy of a backup, and still prunes plain copies", async () => {
    const context = await createInitializedTestContext("trash-prune-pinned");
    try {
      const relatives: string[] = [];
      for (let index = 0; index < 13; index += 1) {
        const relative = `.claude/skills/s${index}/SKILL.md`;
        relatives.push(relative);
        seedOwned(context, relative, `# ${index}\n`);
        executeSafeFileRemovals(context.homeDir, [relative], { applyId: `apply-p${index}`, snapshotId: `snap-p${index}` });
      }
      // Loose old folders with no row are plain copies and age out.
      for (let index = 0; index < 12; index += 1) {
        const loose = join(applyTrashRoot(), `loose-${index}`);
        mkdirSync(loose, { recursive: true });
        writeFileSync(join(loose, "f.txt"), "x");
        const old = new Date(Date.now() - (100 + index) * 1000);
        utimesSync(loose, old, old);
      }

      pruneApplyTrash();

      for (let index = 0; index < 13; index += 1) {
        expect(existsSync(join(applyTrashRoot(), `apply-p${index}`))).toBe(true);
      }
      const loose = fs.readdirSync(applyTrashRoot()).filter((name) => name.startsWith("loose-"));
      expect(loose.length).toBeLessThanOrEqual(10);
      const restored = restoreSafeRemovalBackup({ snapshotId: "snap-p0", rootPath: context.homeDir });
      expect(restored).toEqual([relatives[0]!]);
      expect(readFileSync(join(context.homeDir, relatives[0]!), "utf-8")).toBe("# 0\n");
    } finally {
      await context.cleanup();
    }
  });
});
