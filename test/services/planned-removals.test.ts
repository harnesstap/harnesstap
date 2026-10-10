import { describe, expect, it } from "bun:test";
import {
  groupPlannedRemovals,
  plannedRemovalsFromApplyFields,
  riskyRemovalPaths,
} from "../../src/services/safe-file-removal.ts";

describe("planned removal groups", () => {
  it("splits owned unmodified, modified, and unmanaged", () => {
    const groups = groupPlannedRemovals({
      remove: ["owned.md"],
      skip: [
        { path: "edited.md", reason: "modified" },
        { path: "notes.md", reason: "unmanaged" },
        { path: "old.md", reason: "preexisting" },
        { path: "gone.md", reason: "missing" },
      ],
    });
    expect(groups).toEqual({
      owned_unmodified: ["owned.md"],
      owned_modified: ["edited.md"],
      unmanaged: ["notes.md", "old.md"],
    });
    expect(riskyRemovalPaths(groups)).toEqual(["edited.md", "notes.md", "old.md"]);
  });

  it("maps apply result fields the same way", () => {
    expect(
      plannedRemovalsFromApplyFields({
        removed_files: ["a.md"],
        skipped_removals: [{ path: "b.md", reason: "modified" }],
      }),
    ).toEqual({
      owned_unmodified: ["a.md"],
      owned_modified: ["b.md"],
      unmanaged: [],
    });
  });
});
