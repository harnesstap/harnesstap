import { describe, expect, it } from "bun:test";
import { parseOnConflict } from "../../src/cli/on-conflict.ts";
import {
  applyWroteLine,
  CLI_ERRORS,
  CLI_HINTS,
  restoredRemovedLine,
  SCOPE_COPY,
  snapshotSavedUndoLine,
} from "../../src/copy/cli.ts";

describe("DS-6 CLI copy", () => {
  it("maps hidden on-conflict aliases overwrite, ignore and fail only", () => {
    expect(parseOnConflict("overwrite")).toBe("replace");
    expect(parseOnConflict("ignore")).toBe("skip");
    expect(parseOnConflict("fail")).toBe("cancel");
    expect(parseOnConflict("replace")).toBe("replace");
    expect(() => parseOnConflict("abort")).toThrow(
      "Invalid --on-conflict value: abort. Use replace, skip, prompt or cancel.",
    );
  });

  it("uses replace in the duplicate-name hint", () => {
    expect(CLI_ERRORS.pluginAlreadyExists("demo-plugin")).toBe(
      'A plugin named "demo-plugin" already exists.',
    );
    expect(CLI_HINTS.onConflictReplace).toBe("Use --on-conflict replace to replace it.");
  });

  it("prints switch unsaved-change lines", () => {
    expect(CLI_ERRORS.unsavedChanges("global default", 3)).toBe(
      '"global default" has 3 unsaved changes.',
    );
    expect(CLI_HINTS.unsavedChanges).toBe(
      "Run again with --changes save, stash or discard.",
    );
  });

  it("keeps the Main tooltip string", () => {
    expect(SCOPE_COPY.mainHarnessTooltip).toBe(
      "Your main harness. It wins when harnesses disagree.",
    );
  });

  it("prints the snapshot undo line with the revert command", () => {
    expect(snapshotSavedUndoLine("ht revert 01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
      "Snapshot saved. Undo with: ht revert 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    );
  });

  it("treats a no-op re-apply as up to date even when files were kept", () => {
    expect(
      applyWroteLine({ wrote: 0, removed: 0, kept: 6, unchanged: 16 }),
    ).toBe("Everything is up to date. 16 unchanged.");
    expect(applyWroteLine({ wrote: 0, removed: 0, kept: 6 })).toBe(
      "Everything is up to date.",
    );
  });

  it("uses future tense for revert dry-run", () => {
    expect(restoredRemovedLine(16, 5, { dryRun: true })).toBe(
      "Would restore 16, would remove 5.",
    );
    expect(restoredRemovedLine(16, 5)).toBe("Restored 16, removed 5.");
  });
});
