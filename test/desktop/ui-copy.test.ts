import { describe, expect, it } from "bun:test";
import {
  APPLY_RESULT_COPY,
  DETECT_HARNESSES_COMMAND,
  EMPTY_PROFILE_COPY,
  HARNESS_MAIN_PILL_TOOLTIP,
  MARKETPLACE_URL_INVALID,
  PREVIEW_FILE_COPY,
  REMOVAL_CONFIRM_COPY,
  SYNC_HARNESSES_COMMAND,
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
      EMPTY_PROFILE_COPY.title,
      EMPTY_PROFILE_COPY.body,
      MARKETPLACE_URL_INVALID,
      DETECT_HARNESSES_COMMAND,
      SYNC_HARNESSES_COMMAND,
      PREVIEW_FILE_COPY.willRemove,
      PREVIEW_FILE_COPY.keptChanged,
      PREVIEW_FILE_COPY.keptUnmanaged,
      REMOVAL_CONFIRM_COPY.title,
      REMOVAL_CONFIRM_COPY.description,
      REMOVAL_CONFIRM_COPY.keepTheseFiles,
      REMOVAL_CONFIRM_COPY.removeThemToo,
      APPLY_RESULT_COPY.wroteRemovedKept(3, 1, 2),
      APPLY_RESULT_COPY.viewSnapshot,
    ].join("\n");
    expect(blob).not.toMatch(/[\u2013\u2014\u2026]/);
  });

  it("uses empty-profile copy when no filter is active", () => {
    expect(EMPTY_PROFILE_COPY.title).toBe("This profile is empty.");
    expect(EMPTY_PROFILE_COPY.body).toBe("Add resources from Library.");
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
