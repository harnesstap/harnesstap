import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { type ApplyKeptFile, keptFromSkippedRemovals, printKeptFiles } from "../../src/cli/print-apply-summary.ts";
import { recordHostPluginViewFiles } from "../../src/services/package-cache/host-plugin-views.ts";
import { setHostPluginViewForceReplace } from "../../src/services/package-cache/host-plugin-view-policy.ts";
import {
  executeSafeFileRemovals,
  formatRemovalBackupNotice,
} from "../../src/services/safe-file-removal.ts";

function captureKept(force: boolean, kept: ApplyKeptFile[] = [{ path: ".claude/skills/x/notes.md", reason: "unmanaged" }]): string {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message?: unknown) => {
    lines.push(String(message ?? ""));
  });
  setHostPluginViewForceReplace(force);
  try {
    printKeptFiles(kept);
  } finally {
    setHostPluginViewForceReplace(false);
    log.mockRestore();
  }
  return lines.join("\n");
}

describe("--force-remove hint", () => {
  it("tells you to rerun the same command, not ht apply", () => {
    const text = captureKept(false);
    expect(text).toContain("run the command again with --force-remove");
    expect(text).not.toContain("ht apply --force-remove");
  });

  it("does not suggest --force-remove when it was already used", () => {
    const text = captureKept(true);
    expect(text).not.toContain("run the command again with --force-remove");
    expect(text).toContain("even with --force-remove");
  });

  it("does not suggest --force-remove when it would remove none of the kept files", () => {
    const text = captureKept(false, [
      { path: ".claude/plugins/cache/m/p/1.0.0/notes.md", reason: "unmanaged", forceable: false },
    ]);
    expect(text).not.toContain("run the command again with --force-remove");
    expect(text).toContain("even with --force-remove");
  });

  it("suggests it, for the files it helps, when only some kept files can be removed", () => {
    const text = captureKept(false, [
      { path: ".claude/plugins/cache/m/p/1.0.0/notes.md", reason: "unmanaged", forceable: false },
      { path: ".claude/skills/x/SKILL.md", reason: "modified" },
    ]);
    expect(text).toContain("To remove it too, run the command again with --force-remove.");
  });

  it("carries the not-forceable mark from a skipped removal", () => {
    expect(
      keptFromSkippedRemovals([
        { path: "a", reason: "unmanaged", forceable: false },
        { path: "b", reason: "modified" },
        { path: "c", reason: "preexisting", forceable: false },
      ]),
    ).toEqual([
      { path: "a", reason: "unmanaged", forceable: false },
      { path: "b", reason: "modified" },
      { path: "c", reason: "unmanaged", forceable: false },
    ]);
  });

  it("marks a plugin folder file HarnessTap did not write as not removable by --force-remove", async () => {
    const context = await createInitializedTestContext("force-remove-folder-mark");
    try {
      const relative = ".claude/plugins/cache/m/p/1.0.0/mine.md";
      const full = join(context.homeDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "mine\n", "utf-8");
      // The folder has a record, and the file is not in it: HarnessTap did not write it.
      recordHostPluginViewFiles({ hostView: join(full, ".."), created: true, files: {} });
      const plain = executeSafeFileRemovals(context.homeDir, [relative], { dryRun: true });
      expect(plain.skipped.map((entry) => entry.forceable)).toEqual([false]);
    } finally {
      await context.cleanup();
    }
  });

  it("names the files --force-remove removed that would have been kept", async () => {
    const context = await createInitializedTestContext("force-remove-names");
    try {
      const relative = ".claude/skills/mine/SKILL.md";
      const full = join(context.homeDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "my own skill\n", "utf-8");
      const result = executeSafeFileRemovals(context.homeDir, [relative], { forceRemove: true });
      expect(result.removed).toEqual([relative]);
      expect(result.forced).toEqual([{ path: relative, reason: "unmanaged" }]);
      const notice = formatRemovalBackupNotice(result, context.homeDir) ?? "";
      expect(notice).toContain("only because of --force-remove");
      expect(notice).toContain(`${relative} (not made by HarnessTap)`);
      expect(notice.match(/Backup:/g)?.length).toBe(1);
    } finally {
      await context.cleanup();
    }
  });
});
