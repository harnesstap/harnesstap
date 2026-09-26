import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopCss } from "./helpers/desktop-css.ts";
import {
  syncHarnessesConfirmBody,
  syncHarnessesDisabledReason,
  syncHarnessesTooltip,
} from "../../apps/desktop/src/lib/harness-sync.ts";

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
const stylesSource = readDesktopCss();

describe("Harnesses sync CTA", () => {
  it("uses the Profiles Apply twin classes and locked copy", () => {
    expect(sidebarSource).toContain('className={["btn", "primary", "rail-apply-action"');
    expect(sidebarSource).toContain("ArrowLeftRight");
    expect(workspaceSource).toContain("Sync harnesses");
    expect(workspaceSource).toContain("Syncing…");
    expect(workspaceSource).toContain('title="Sync harnesses"');
    expect(workspaceSource).toContain('confirmLabel={syncing ? "Syncing…" : "Sync"}');
    const apiSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/lib/api/harnesses.ts"),
      "utf8",
    );
    expect(apiSource).toContain("/v1/harness/sync");
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
    expect(designSource).toContain("Sticky footer under the configured list");
    expect(stylesSource).toContain(".harness-sync-controls");
  });
});
