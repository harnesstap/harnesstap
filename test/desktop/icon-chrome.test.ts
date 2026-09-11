import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resourceTypeGlyph } from "../../apps/desktop/src/lib/type-glyph.ts";

const root = join(import.meta.dir, "../../apps/desktop/src");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const appSource = read("App.tsx");
const typeIconSource = read("components/TypeIcon.tsx");
const typeModalSource = read("components/ResourceTypeModal.tsx");
const liveStateSource = read("components/LiveStatePanel.tsx");
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
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
  test("shares IconActionButton with title and optional visible label beside the icon", () => {
    expect(iconButtonSource).toContain("ChromeTooltip");
    expect(iconButtonSource).toContain("title ?? label");
    expect(iconButtonSource).not.toContain("title={title ?? label}");
    expect(iconButtonSource).toContain("icon-action");
    expect(iconButtonSource).toContain("showLabel");
    expect(iconButtonSource).toContain("iconAfterLabel");
    expect(iconButtonSource).toContain("has-label");
    expect(iconButtonSource).toContain("aria-label={showLabel ? undefined : label}");
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

  test("converts install-gap plugin Install to icon-only chrome", () => {
    const installGaps = liveStateSource.slice(
      liveStateSource.indexOf("Install gaps (in profile)"),
      liveStateSource.indexOf("File changes"),
    );
    expect(installGaps).toContain("installGapSyncAction");
    expect(installGaps).toContain("installGapGroups.map");
    expect(installGaps).toContain("IconActionButton");
    expect(installGaps).toContain("label={syncAction.label}");
    expect(installGaps).toContain("PackagePlus");
    expect(installGaps).toContain("installGapQuietVerb");
    expect(installGaps).not.toContain("showLabel");
    expect(installGaps).not.toContain('className="btn"');
    expect(installGaps).not.toContain("Sparkles");
    expect(installGaps).toContain("installGapStatusLabel");
    expect(installGaps).toContain("CircleDashed");
    expect(installGaps).toContain("CircleAlert");
    expect(installGaps).toContain("ChromeTooltip");
    expect(liveStateSource).toContain("label: `Install ${pluginName}`");
  });

  test("Sparkles is the skill type glyph only; agents use Bot; gaps use status glyphs", () => {
    const typeGlyphSource = read("lib/type-glyph.ts");
    expect(typeGlyphSource).toMatch(/case "skill":\s*return "sparkles"/);
    expect(typeIconSource).toMatch(/case "sparkles":[\s\S]*?Sparkles/);
    expect(typeGlyphSource).toMatch(/case "agent":\s*return "bot"/);
    expect(typeIconSource).toMatch(/case "bot":[\s\S]*?Bot/);
    expect(typeIconSource).not.toMatch(/case "agent":[\s\S]*?Sparkles/);
    expect(typeModalSource).toContain("skill: Sparkles");
    expect(typeModalSource).toContain("agent: Bot");
    const notStagedRow = liveStateSource.slice(
      liveStateSource.indexOf("function UntrackedResourceRow"),
      liveStateSource.indexOf("function EnabledResourceRow"),
    );
    expect(notStagedRow).toContain("CircleDashed");
    expect(notStagedRow).toContain("CircleAlert");
    expect(notStagedRow).toContain("ChromeTooltip");
    expect(notStagedRow).not.toContain("Sparkles");
    expect(notStagedRow).not.toContain("RelatedHarnessIcons");
    expect(notStagedRow).not.toContain("ResourceRowMeta");
    expect(notStagedRow).toContain('label="Add"');
    expect(notStagedRow).toContain("showLabel");
    expect(designSource).toContain("never instruction, plugin, plugin package");
    expect(designSource).toContain("agent, Not staged");
    expect(designSource).toContain(
      "Lucide Sparkles is the **skill** type glyph only",
    );
    expect(designSource).toContain("Agents use **Bot**");
    expect(designSource).toContain("Pencil stays profile **Edit**");
    expect(designSource).toContain("the Settings gear stays Settings");
    expect(appSource).toContain("profile-item-edit");
    expect(appSource).toContain("<Pencil size={RAIL_ICON_SIZE}");
    expect(appSource).toContain('label="Settings"');
    expect(appSource).toContain("<Settings size={HEADER_ICON_SIZE}");
  });

  test("instruction, plugin, and package rows never map to or render Sparkles", () => {
    expect(resourceTypeGlyph("skill")).toBe("sparkles");
    for (const type of [
      "instruction",
      "plugin",
      "plugin_ref",
      "plugin_pin",
      "agent",
      "mcp_server",
      "rule",
    ] as const) {
      expect(resourceTypeGlyph(type)).not.toBe("sparkles");
    }
    expect(resourceTypeGlyph("plugin")).toBe("layers");
    expect(resourceTypeGlyph("plugin_ref")).toBe("package");
    expect(resourceTypeGlyph("instruction")).toBe("file-text");

    const sparklesImportFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) {
          continue;
        }
        const source = readFileSync(full, "utf8");
        if (/import\s*\{[^}]*\bSparkles\b/.test(source)) {
          sparklesImportFiles.push(full.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(sparklesImportFiles.sort()).toEqual([
      "components/ResourceTypeModal.tsx",
      "components/TypeIcon.tsx",
    ]);
    expect(read("lib/type-glyph.ts")).toMatch(/case "skill":\s*return "sparkles"/);
    expect(read("lib/type-glyph.ts")).not.toMatch(
      /case "(instruction|plugin|plugin_ref|plugin_pin)":\s*return "sparkles"/,
    );

    const libraryList = resourcesSource.slice(
      resourcesSource.indexOf("resources-type-heading"),
      resourcesSource.indexOf("function renderMainPane"),
    );
    expect(libraryList).toContain("<TypeIcon type={group.type} />");
    expect(libraryList).toContain("type={filterType}");
    expect(libraryList).not.toContain("Sparkles");
    expect(libraryList).not.toContain("ResourceRowMeta");
    expect(libraryList).not.toContain("RelatedHarnessIcons");

    const pluginGroup = liveStateSource.slice(
      liveStateSource.indexOf("function EnabledPluginGroup"),
      liveStateSource.indexOf("function pinIdentityKey"),
    );
    expect(pluginGroup).toContain('<TypeIcon type="plugin"');
    expect(pluginGroup).not.toContain("Sparkles");
    const pluginSummary = pluginGroup.slice(
      pluginGroup.indexOf("enabled-plugin-summary"),
      pluginGroup.indexOf("enabled-plugin-body"),
    );
    expect(pluginSummary).not.toContain("RelatedHarnessIcons");
    expect(pluginSummary).not.toContain("Sparkles");

    expect(typeModalSource).toMatch(/plugin:\s*Package/);
    expect(typeModalSource).toMatch(/instruction:\s*BookOpen/);
    expect(typeModalSource).not.toMatch(/plugin:\s*Sparkles/);
    expect(typeModalSource).not.toMatch(/instruction:\s*Sparkles/);
  });

  test("converts More and Show all to distinct icons and labels Not staged Add all", () => {
    expect(liveStateSource).toContain('label="Add all"');
    expect(liveStateSource).toContain("ListPlus");
    expect(liveStateSource).toContain("iconAfterLabel");
    expect(liveStateSource).toContain('label="More"');
    expect(liveStateSource).toContain("ChevronsDown");
    expect(liveStateSource).toContain('label="Show all"');
    expect(liveStateSource).toContain("UnfoldVertical");
    expect(liveStateSource).not.toContain('className="link-btn"');
    expect(liveStateSource).not.toContain("TODO(G4)");
    expect(liveStateSource).toContain("primary={!railPrimaryIsReapply}");
    expect(designSource).toContain("Ghost **Add all**");
    expect(designSource).toContain("wontfix");
    expect(liveStateSource).not.toContain("target-preview-drifted");
    expect(liveStateSource).toContain("singletonPath");
    expect(liveStateSource).not.toContain("expandedKeys");
    expect(appSource).toContain('label="Account"');
    expect(appSource).toContain('label="Export setup"');
    expect(appSource).toContain('label="Import setup"');
    expect(appSource).toContain("Refresh live status");
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

  test("labels Library record primary actions and keeps secondary record actions icon-only", () => {
    expect(pluginDetailSource).toContain('label="Apply"');
    expect(pluginDetailSource).toContain("showLabel");
    expect(pluginDetailSource).toContain('label="Update"');
    expect(pluginDetailSource).not.toMatch(/>Update</);
    expect(pluginDetailSource).toMatch(/case "apply":[\s\S]*?showLabel[\s\S]*?label="Apply"/);
    expect(pluginDetailSource).toMatch(/case "restore":[\s\S]*?showLabel[\s\S]*?label="Restore"/);
    expect(resourceDetailSource).toContain('label="Sync"');
    expect(resourceDetailSource).toContain('label="Write"');
    expect(resourceDetailSource).not.toContain('label="Apply sync"');
    expect(resourceDetailSource).toContain("CheckCheck");
    expect(resourceDetailSource).toContain('label="Delete"');
    expect(resourceDetailSource).toMatch(/label="Sync"[\s\S]*?showLabel/);
    expect(resourceDetailSource).toMatch(/label="Write"[\s\S]*?showLabel/);
  });

  test("library Sync tooltip is a preview and does not install into a project", () => {
    expect(resourceDetailSource).toContain("librarySyncPreviewTooltip");
    expect(resourceDetailSource).toContain(
      "Check whether this ${noun} in your library differs from the copy in the marketplace, catalog, or place you got it from.",
    );
    expect(resourceDetailSource).toContain("Does not change files yet.");
    expect(resourceDetailSource).toContain("Does not install into a project.");
    expect(resourceDetailSource).not.toContain("install source");
    expect(resourceDetailSource).not.toContain("home harness");
    expect(resourceDetailSource).toContain("librarySyncPreviewTooltip(detail.type)");
  });

  test("library Write tooltip saves this item’s library files only", () => {
    expect(resourceDetailSource).toContain("pendingSyncWriteTooltip");
    expect(resourceDetailSource).toContain(
      "Save this newer copy over this skill’s library files.",
    );
    expect(resourceDetailSource).toContain(
      "only this skill in the library is updated — not the whole plugin, and not a project.",
    );
    expect(resourceDetailSource).not.toContain("pending sync");
    expect(resourceDetailSource).not.toContain("a project or host");
    expect(resourceDetailSource).toContain("pendingSyncWriteTooltip(detail.type)");
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
    expect(stylesSource).toContain(".icon-action.has-label");
    expect(stylesSource).toContain(".library-detail-actions .icon-action.has-label");
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
