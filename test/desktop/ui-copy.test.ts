import { describe, expect, it } from "bun:test";
import {
  APPLY_RESULT_COPY,
  HARNESS_MAIN_PILL_TOOLTIP,
  PREVIEW_FILE_COPY,
  REMOVAL_CONFIRM_COPY,
  applyResultToastTitle,
} from "../../apps/desktop/src/lib/ui-copy.ts";

describe("desktop ui-copy (DS-1 / DS-6)", () => {
  it("uses the designer Main pill tooltip", () => {
    expect(HARNESS_MAIN_PILL_TOOLTIP).toBe(
      "Your main harness. It wins when harnesses disagree.",
    );
    expect(HARNESS_MAIN_PILL_TOOLTIP).not.toContain("New resources start here");
  });

  it("uses ASCII punctuation only", () => {
    const blob = [
      HARNESS_MAIN_PILL_TOOLTIP,
      PREVIEW_FILE_COPY.willRemove,
      PREVIEW_FILE_COPY.keptChanged,
      PREVIEW_FILE_COPY.keptUnmanaged,
      REMOVAL_CONFIRM_COPY.title,
      REMOVAL_CONFIRM_COPY.description,
      REMOVAL_CONFIRM_COPY.keepTheseFiles,
      REMOVAL_CONFIRM_COPY.removeThemToo,
      APPLY_RESULT_COPY.wroteRemovedKept(3, 1, 2),
      APPLY_RESULT_COPY.viewSnapshot,
      APPLY_RESULT_COPY.takenLine("just now"),
      APPLY_RESULT_COPY.undoWith("abc"),
    ].join("\n");
    expect(blob).not.toMatch(/[\u2013\u2014\u2026]/);
  });

  it("formats the apply result toast", () => {
    expect(applyResultToastTitle({ wrote: 3, removed: 1, kept: 2 })).toBe(
      "Wrote 3, removed 1, kept 2",
    );
    expect(applyResultToastTitle({ wrote: 0, removed: 0, kept: 0, unchanged: 32 })).toBe(
      "Everything is up to date. 32 unchanged.",
    );
  });
});
