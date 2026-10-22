import { describe, expect, it } from "bun:test";
import {
  formatRemovalBackupNotice,
  type SafeFileRemovalResult,
} from "../../src/services/safe-file-removal.ts";

function result(backupDir: string, removed = ["a", "b"]): SafeFileRemovalResult {
  return { applyId: "01", backupDir, removed, skipped: [], warnings: [] };
}

describe("formatRemovalBackupNotice", () => {
  it("abbreviates a backup under home", () => {
    expect(
      formatRemovalBackupNotice(result("/home/me/.harnesstap/trash/01"), "/home/me"),
    ).toBe("Removed 2 files. Backup: ~/.harnesstap/trash/01");
  });

  it("prints the full path when HARNESSTAP_HOME is outside home", () => {
    expect(
      formatRemovalBackupNotice(result("/workspace/ht/trash/01", ["a"]), "/home/me"),
    ).toBe("Removed 1 file. Backup: /workspace/ht/trash/01");
  });

  it("does not treat a sibling directory with the same prefix as home", () => {
    expect(
      formatRemovalBackupNotice(result("/home/me2/.harnesstap/trash/01"), "/home/me"),
    ).toBe("Removed 2 files. Backup: /home/me2/.harnesstap/trash/01");
  });

  it("abbreviates a Windows backup under home with forward slashes", () => {
    expect(
      formatRemovalBackupNotice(
        result("C:\\Users\\me\\.harnesstap\\trash\\01"),
        "C:\\Users\\me",
      ),
    ).toBe("Removed 2 files. Backup: ~/.harnesstap/trash/01");
  });

  it("says nothing when nothing was removed", () => {
    expect(formatRemovalBackupNotice(result("/home/me/x", []), "/home/me")).toBeUndefined();
  });
});
