import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatHarnessSyncChangeSummary,
  HARNESS_SYNC_PREVIEW_ERROR,
  syncHarnessesConfirmBody,
  syncHarnessesDisabledReason,
  syncHarnessesTooltip,
} from "../../apps/desktop/src/lib/harness-sync.ts";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const workspaceSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/harnesses/HarnessesWorkspace.tsx",
  ),
  "utf8",
);
const sidebarSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/harnesses/HarnessSidebar.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
const dialogSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/harnesses/SyncHarnessesDialog.tsx",
  ),
  "utf8",
);
const apiSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/lib/api/harnesses.ts"),
  "utf8",
);
const stylesSource = readDesktopCss();

describe("Harnesses sync CTA", () => {
  it("uses the Profiles Apply twin classes and locked copy", () => {
    expect(sidebarSource).toContain('className={["btn", "primary", "rail-apply-action"');
    expect(sidebarSource).toContain("ArrowLeftRight");
    expect(workspaceSource).toContain("Sync harnesses");
    expect(workspaceSource).toContain("Syncing...");
    expect(workspaceSource).toContain("<SyncHarnessesDialog");
    expect(dialogSource).toContain('title="Sync harnesses"');
    expect(dialogSource).toContain('confirmLabel={syncing ? "Syncing..." : "Sync"}');
    expect(dialogSource).toContain("Counting resource changes...");
    expect(dialogSource).toContain("formatHarnessSyncChangeSummary");
    expect(dialogSource).toContain("file-change-kind-badge");
    expect(dialogSource).toContain('mark: "+"');
    expect(dialogSource).toContain('mark: "−"');
    expect(dialogSource).toContain('mark: "~"');
    expect(dialogSource).toContain('confirmDisabled={counting}');
    expect(apiSource).toContain("/v1/harness/sync");
    expect(apiSource).toContain("dry_run: true");
    expect(apiSource).toContain("harness_changes");
    expect(syncHarnessesTooltip()).toBe(
      "Merge across registered harnesses. Newest on-disk copy wins conflicts.",
    );
    expect(syncHarnessesConfirmBody()).toContain("Prefers shared paths.");
    expect(syncHarnessesConfirmBody()).toContain(
      "Cursor and Claude plugin skills also land in .agents",
    );
    expect(syncHarnessesConfirmBody()).not.toContain("—");
    expect(syncHarnessesDisabledReason({
      configuredCount: 1,
      running: false,
    })).toBe("Add another harness to sync");
    expect(formatHarnessSyncChangeSummary({
      added: 0,
      removed: 0,
      modified: 0,
    })).toBe("no resource changes");
    expect(formatHarnessSyncChangeSummary({
      added: 2,
      removed: 0,
      modified: 0,
    })).toBe("2 added");
    expect(formatHarnessSyncChangeSummary({
      added: 1,
      removed: 3,
      modified: 5,
    })).toBe("1 added, 3 removed, 5 modified");
    expect(HARNESS_SYNC_PREVIEW_ERROR).not.toContain("—");
    expect(designSource).toContain("Sticky footer under the configured list");
    expect(designSource).toContain("Counting resource changes…");
    expect(designSource).toContain("dry_run: true");
    expect(stylesSource).toContain(".harness-sync-controls");
    expect(stylesSource).toContain(".harness-sync-preview-badges");
    expect(workspaceSource).not.toContain("—");
    expect(dialogSource).not.toContain("—");
  });
});
