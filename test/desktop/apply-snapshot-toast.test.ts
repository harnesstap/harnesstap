import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  applyOutcomeFromUnknown,
  applySnapshotDialogCopy,
  applySuccessToast,
} from "../../apps/desktop/src/lib/apply-result.ts";
import { APPLY_RESULT_COPY } from "../../apps/desktop/src/lib/ui-copy.ts";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const controller = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/state/scope-controller.ts"),
  "utf8",
);
const overlays = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/shell/AppOverlays.tsx"),
  "utf8",
);
const toastRegion = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/shell/ToastRegion.tsx"),
  "utf8",
);
const confirm = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ConfirmDialog.tsx"),
  "utf8",
);
const shots = readFileSync(
  join(import.meta.dir, "../../apps/desktop/scripts/ui-shots.mjs"),
  "utf8",
);
const gallery = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/live/ActionToastVisualGallery.tsx",
  ),
  "utf8",
);
const css = readDesktopCss();

describe("apply snapshot dialog and action toast", () => {
  it("does not open the snapshot dialog from apply success", () => {
    expect(controller).not.toMatch(/setApplySnapshot\([^)]+\);\s*toast\(/);
    expect(controller).toContain("onClick: () => setApplySnapshot(applyToast.snapshot)");
    expect(overlays).toContain("ctrl.applySnapshot !== null");
    expect(overlays).toContain("cancelLabel={null}");
    expect(overlays).not.toContain('cancelLabel=""');
    expect(confirm).toContain("const showCancel = Boolean(cancelLabel)");
  });

  it("describes when the snapshot was taken, what changed, and how to undo", () => {
    const copy = applySnapshotDialogCopy(
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        takenAt: "2026-10-10T18:00:00.000Z",
        wrote: 7,
        removed: 1,
        kept: 2,
      },
      new Date("2026-10-10T18:00:20.000Z"),
    );
    expect(copy.taken).toBe("Taken just now");
    expect(copy.changed).toBe("Wrote 7, removed 1, kept 2");
    expect(copy.undo).toBe(
      "Undo with ht revert 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    );
    expect(APPLY_RESULT_COPY.close).toBe("Close");
    expect(overlays).toContain("applySnapshotDialogCopy");
  });

  it("keeps action toast text wrapping on words with the button inside the toast", () => {
    expect(toastRegion).toContain("function ToastCard");
    expect(toastRegion).toContain("toast-body");
    expect(toastRegion).toContain("toast-action");
    expect(css).toContain(".toast-title");
    expect(css).toMatch(/\.toast-title\s*\{[^}]*overflow-wrap:\s*break-word/);
    expect(css).not.toMatch(/\.toast-title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(gallery).toContain("ToastCard");
    expect(gallery).toContain("wroteRemovedKept(0, 6, 19)");
    expect(shots).toContain("action-toast");
    expect(shots).toContain('visual", "action-toast"');
  });

  it("builds a snapshot payload from apply results without auto-opening", () => {
    const toast = applySuccessToast(
      {
        written_files: ["a"],
        removed_files: ["b"],
        snapshot_id: "snap-1",
        removals: { owned_unmodified: [], owned_modified: ["c"], unmanaged: [] },
      },
      "2026-10-10T18:00:00.000Z",
    );
    expect(toast.title).toBe("Wrote 1, removed 1, kept 1");
    expect(toast.snapshot).toEqual({
      id: "snap-1",
      takenAt: "2026-10-10T18:00:00.000Z",
      wrote: 1,
      removed: 1,
      kept: 1,
    });
    expect(applyOutcomeFromUnknown({}).snapshotId).toBeNull();
  });
});
