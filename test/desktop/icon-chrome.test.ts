import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "../../apps/desktop/src");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const appSource = read("App.tsx");
const liveStateSource = read("components/LiveStatePanel.tsx");
const resourcesSource = read("components/ResourcesPanel.tsx");
const sourcesWorkspaceSource = read("components/SourcesWorkspace.tsx");
const recordActionsSource = read("components/SourcesRecordActions.tsx");
const sourceSidebarSource = read("components/SourceSidebar.tsx");
const pluginDetailSource = read("components/PluginPackageDetail.tsx");
const resourceDetailSource = read("components/ResourceDetailBody.tsx");
const pendingSource = read("components/PendingApprovalsStrip.tsx");
const updateSource = read("components/UpdateAvailableControl.tsx");
const iconButtonSource = read("components/IconActionButton.tsx");
const stylesSource = readFileSync(
  join(root, "styles.css"),
  "utf8",
);

describe("desktop icon chrome", () => {
  test("shares IconActionButton with title and aria-label from the original label", () => {
    expect(iconButtonSource).toContain("aria-label={label}");
    expect(iconButtonSource).toContain("title={title ?? label}");
    expect(iconButtonSource).toContain("icon-action");
  });

  test("converts Profiles filter Clear and Project Install to icon-only", () => {
    expect(appSource).toContain('label="Clear"');
    expect(appSource).not.toContain("rail-clear-button");
    expect(appSource).toContain('data-testid="project-install"');
    expect(appSource).toContain("HardDriveDownload");
    expect(appSource).toContain('variant="icon"');
  });

  test("keeps Profiles rail Apply as a full-width labeled accent button with icon on the right", () => {
    expect(appSource).toContain("rail-apply-action");
    expect(appSource).toContain('"btn", "primary", "rail-apply-action"');
    expect(appSource).toContain('? "Re-apply"');
    expect(appSource).toContain(': "Apply"');
    expect(appSource).toMatch(
      /\{switching \? "Applying…" : showReapply \? "Re-apply" : "Apply"\}[\s\S]{0,400}<(RotateCw|Check) /,
    );
    expect(stylesSource).toContain(".rail-controls .btn");
    expect(stylesSource).toContain("width: 100%");
    expect(stylesSource).not.toContain(".rail-controls .icon-action.primary");
  });

  test("converts Profile resources Add all, More, and Show all to distinct icons", () => {
    expect(liveStateSource).toContain('label="Add all"');
    expect(liveStateSource).toContain("ListPlus");
    expect(liveStateSource).toContain('label="More"');
    expect(liveStateSource).toContain("ChevronsDown");
    expect(liveStateSource).toContain('label="Show all"');
    expect(liveStateSource).toContain("UnfoldVertical");
    expect(liveStateSource).not.toContain('className="link-btn"');
  });

  test("converts Library and Sources header clusters to icon-only", () => {
    expect(resourcesSource).toContain('label="Create resource"');
    expect(resourcesSource).toContain('label="Import"');
    expect(resourcesSource).toContain('label="Tracked directories"');
    expect(resourcesSource).toContain('label="Update all"');
    expect(resourcesSource).not.toMatch(/<Plus[\s\S]*\/>\s*Create resource\s*</);
    expect(sourcesWorkspaceSource).toContain('label="Add marketplace"');
    expect(sourcesWorkspaceSource).toContain('label="Connect catalog"');
    expect(sourcesWorkspaceSource).toContain("Store");
    expect(sourcesWorkspaceSource).toContain("Cloud");
  });

  test("converts Sources record and sidebar row actions to icon-only", () => {
    expect(recordActionsSource).toContain('label="Pull"');
    expect(recordActionsSource).toContain('label="Pin to plugin"');
    expect(recordActionsSource).toContain('label="Attach to plugin"');
    expect(recordActionsSource).toContain('label="Open in Library"');
    expect(sourceSidebarSource).toContain('label="Edit"');
    expect(sourceSidebarSource).toContain('label="Remove"');
    expect(sourceSidebarSource).toContain('label="Disconnect"');
    expect(sourceSidebarSource).toContain('label="Unregister"');
  });

  test("converts library detail record actions to icon-only", () => {
    expect(pluginDetailSource).toContain('label="Apply"');
    expect(pluginDetailSource).toContain('label="Update"');
    expect(pluginDetailSource).not.toMatch(/>Update</);
    expect(resourceDetailSource).toContain('label="Sync"');
    expect(resourceDetailSource).toContain('label="Apply sync"');
    expect(resourceDetailSource).toContain("CheckCheck");
    expect(resourceDetailSource).toContain('label="Delete"');
  });

  test("keeps pending-approval Approve/Deny labels in tooltips", () => {
    expect(pendingSource).toContain('label="Approve"');
    expect(pendingSource).toContain('label="Deny"');
  });

  test("keeps the GitHub release control as a link, not a chrome button", () => {
    expect(updateSource).toContain('className="link-btn"');
    expect(updateSource).toContain("GitHub release");
    expect(updateSource).not.toContain("GitHub release\n              </button>");
  });

  test("styles primary icon-action for remaining accent icon CTAs", () => {
    expect(stylesSource).toContain(".icon-action.primary");
    expect(stylesSource).toContain("background: var(--accent)");
  });

  test("keeps default icon-action at the 32px size token", () => {
    expect(stylesSource).toContain("--icon-action-size: 32px");
    const needle = "\n.icon-action {";
    const start = stylesSource.indexOf(needle);
    expect(start).toBeGreaterThan(-1);
    const defaultIcon = stylesSource.slice(
      start,
      stylesSource.indexOf("}", start) + 1,
    );
    expect(defaultIcon).toContain("width: var(--icon-action-size)");
    expect(defaultIcon).toContain("height: var(--icon-action-size)");
    expect(defaultIcon).not.toContain("width: var(--icon-action-size-lg)");
  });
});
