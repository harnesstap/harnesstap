import { describe, expect, it } from "bun:test";
import { parseOnConflict } from "../../src/cli/on-conflict.ts";
import {
  applyWroteLine,
  CLI_ERRORS,
  CLI_HINTS,
  discardedChangesLine,
  formatHtArgs,
  plainTerminalText,
  restoredRemovedLine,
  savedChangesLine,
  SCOPE_COPY,
  snapshotSavedUndoLine,
  stashedChangesLine,
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

  it("counts kept files when nothing was written or removed", () => {
    expect(
      applyWroteLine({ wrote: 0, removed: 0, kept: 6, unchanged: 16 }),
    ).toBe("Wrote 0, removed 0, kept 6, unchanged 16.");
    expect(applyWroteLine({ wrote: 0, removed: 0, kept: 22 })).toBe(
      "Wrote 0, removed 0, kept 22.",
    );
    expect(applyWroteLine({ wrote: 0, removed: 0, kept: 0, unchanged: 29 })).toBe(
      "Everything is up to date. 29 unchanged.",
    );
  });

  it("pluralizes one stashed, saved, or discarded change", () => {
    expect(stashedChangesLine(1, "ht profile stash pop")).toBe(
      "Stashed 1 change. Bring them back with: ht profile stash pop",
    );
    expect(stashedChangesLine(2, "ht profile stash pop")).toBe(
      "Stashed 2 changes. Bring them back with: ht profile stash pop",
    );
    expect(savedChangesLine("work", 1)).toBe('Saved 1 change to "work".');
    expect(discardedChangesLine(1)).toBe("Discarded 1 change.");
  });

  it("quotes ht hints when a name contains a space", () => {
    expect(formatHtArgs(["profile", "use", "global default"])).toBe(
      'ht profile use "global default"',
    );
    expect(formatHtArgs(["plugin", "delete", "my team"])).toBe(
      'ht plugin delete "my team"',
    );
  });

  it("renders scenario markdown links as terminal text", () => {
    expect(
      plainTerminalText(
        "see [Scenario 28](https://github.com/harnesstap/harnesstap/blob/main/docs/scenarios/details/28-machine-migration.md)",
      ),
    ).toBe(
      "see Scenario 28 (https://github.com/harnesstap/harnesstap/blob/main/docs/scenarios/details/28-machine-migration.md)",
    );
    expect(plainTerminalText("see [Scenario 28](./28-machine-migration.md)")).toBe(
      "see Scenario 28",
    );
  });

  it("uses future tense for revert dry-run", () => {
    expect(restoredRemovedLine(16, 5, { dryRun: true })).toBe(
      "Would restore 16, would remove 5.",
    );
    expect(restoredRemovedLine(16, 5)).toBe("Restored 16, removed 5.");
  });
});
