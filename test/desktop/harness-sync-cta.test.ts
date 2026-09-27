import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatHarnessSyncChangeCount,
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
    expect(workspaceSource).toContain("Syncing…");
    expect(workspaceSource).toContain("<SyncHarnessesDialog");
    expect(dialogSource).toContain('title="Sync harnesses"');
    expect(dialogSource).toContain('confirmLabel={syncing ? "Syncing…" : "Sync"}');
    expect(dialogSource).toContain("Counting changes…");
    expect(dialogSource).toContain("formatHarnessSyncChangeCount");
    expect(dialogSource).toContain('confirmDisabled={counting}');
    expect(apiSource).toContain("/v1/harness/sync");
    expect(apiSource).toContain("dry_run: true");
    expect(apiSource).toContain("harness_changes");
    expect(syncHarnessesTooltip("Claude Code")).toBe(
      "Merge across configured harnesses. Claude Code wins conflicts.",
    );
    expect(syncHarnessesConfirmBody("Claude Code")).toContain("Prefers shared paths.");
    expect(syncHarnessesConfirmBody("Claude Code")).toContain(
      "Cursor and Claude plugin skills also land in .agents",
    );
    expect(syncHarnessesConfirmBody("Claude Code")).not.toContain("—");
    expect(syncHarnessesDisabledReason({
      configuredCount: 1,
      hasMain: true,
      running: false,
    })).toBe("Add another harness to sync");
    expect(formatHarnessSyncChangeCount(0)).toBe("0 changes");
    expect(formatHarnessSyncChangeCount(1)).toBe("1 change");
    expect(formatHarnessSyncChangeCount(3)).toBe("3 changes");
    expect(HARNESS_SYNC_PREVIEW_ERROR).not.toContain("—");
    expect(designSource).toContain("Sticky footer under the configured list");
    expect(designSource).toContain("Counting changes…");
    expect(designSource).toContain("dry_run: true");
    expect(stylesSource).toContain(".harness-sync-controls");
    expect(stylesSource).toContain(".harness-sync-preview-count");
    expect(workspaceSource).not.toContain("—");
    expect(dialogSource).not.toContain("—");
  });
});
