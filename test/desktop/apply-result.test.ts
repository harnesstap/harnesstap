import { describe, expect, it } from "bun:test";
import { applyOutcomeFromUnknown, applySuccessToast } from "../../apps/desktop/src/lib/apply-result.ts";

describe("desktop apply result counts", () => {
  it("counts unchanged files on a no-op home apply", () => {
    const outcome = applyOutcomeFromUnknown({
      written_files: [],
      removed_files: [],
      files: Array.from({ length: 19 }, (_, index) => `.file-${index}`),
      skipped_files: Array.from({ length: 19 }, (_, index) => `.file-${index}`),
      snapshot_id: "snap-1",
    });
    expect(outcome.wrote).toBe(0);
    expect(outcome.unchanged).toBe(19);
    expect(applySuccessToast({
      written_files: [],
      removed_files: [],
      files: outcome.wrote === 0 ? Array.from({ length: 19 }, (_, index) => `.file-${index}`) : [],
      snapshot_id: "snap-1",
    }).title).toBe("Everything is up to date. 19 unchanged.");
  });
});
