import { describe, expect, it, spyOn } from "bun:test";
import { printApplyPayload } from "../../src/cli/print-apply-summary.ts";
import { formatRemovalBackupNotice } from "../../src/services/safe-file-removal.ts";

describe("apply backup folder", () => {
  it("is named once: the removal notice says it and the summary does not repeat it", () => {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((message?: unknown) => {
      lines.push(String(message ?? ""));
    });
    try {
      const notice = formatRemovalBackupNotice(
        { applyId: "01", backupDir: "/h/.harnesstap/trash/01", removed: ["a.md", "b.md"], skipped: [], warnings: [] },
        "/h",
      );
      if (notice) console.log(notice);
      printApplyPayload({
        profile_name: "pr",
        harnesses: ["claude-code"],
        files: [{}, {}, {}],
        written_files: ["c.md"],
        removed_files: ["a.md", "b.md"],
        removal_backup: "/h/.harnesstap/trash/01",
        snapshot_id: "01",
      });
    } finally {
      log.mockRestore();
    }
    const text = lines.join("\n");
    expect(text.match(/Backup:/g)?.length).toBe(1);
    expect(text).toContain("Removed 2 files. Backup: ~/.harnesstap/trash/01");
    expect(text).toContain("ht revert 01");
  });
});
