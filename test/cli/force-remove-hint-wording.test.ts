import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { printKeptFiles } from "../../src/cli/print-apply-summary.ts";
import { setHostPluginViewForceReplace } from "../../src/services/package-cache/host-plugin-view-policy.ts";
import {
  executeSafeFileRemovals,
  formatRemovalBackupNotice,
} from "../../src/services/safe-file-removal.ts";

function captureKept(force: boolean): string {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message?: unknown) => {
    lines.push(String(message ?? ""));
  });
  setHostPluginViewForceReplace(force);
  try {
    printKeptFiles([{ path: ".claude/skills/x/notes.md", reason: "unmanaged" }]);
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
