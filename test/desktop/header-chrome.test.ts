import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const paritySource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/parity/ParityChrome.tsx"),
  "utf8",
);
const resourcesPanelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourcesPanel.tsx",
  ),
  "utf8",
);
const environmentsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/EnvironmentsWorkspace.tsx",
  ),
  "utf8",
);
const backButtonSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/WorkspaceBackButton.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
const settingsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SettingsDrawer.tsx",
  ),
  "utf8",
);
const cssSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);
const settingsTabsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/SettingsParitySections.tsx",
  ),
  "utf8",
);
const settingsParitySource = settingsTabsSource;

function sliceBetween(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("desktop header chrome", () => {
  test("does not render a sidecar connected glyph", () => {
    expect(appSource).not.toContain("connection-indicator");
    expect(appSource).not.toMatch(/\bUnplug\b/);
  });

  test("keeps a connected test hook for e2e readiness", () => {
    expect(appSource).toContain('"agent-connected"');
  });

  test("exposes Library instead of Resources as a workspace destination", () => {
    expect(appSource).toContain('aria-label="Library"');
    expect(appSource).toContain('setWorkspaceFocus("library")');
    expect(appSource).not.toContain('setWorkspaceFocus("resources")');
    expect(appSource).not.toContain('setWorkspaceFocus("plugins")');
  });

  test("exposes Sources as a workspace destination after Library", () => {
    expect(appSource).toContain('aria-label="Sources"');
    expect(appSource).toContain('onHeaderDestinationClick("sources")');
    expect(appSource).toContain('setWorkspaceFocus("sources")');
    const libraryIdx = appSource.indexOf('aria-label="Library"');
    const sourcesIdx = appSource.indexOf('aria-label="Sources"');
    const parityIdx = appSource.indexOf("<ParityChrome");
    expect(libraryIdx).toBeGreaterThan(-1);
    expect(sourcesIdx).toBeGreaterThan(libraryIdx);
    expect(parityIdx).toBeGreaterThan(sourcesIdx);
  });

  test("DESIGN.md lists Sources in header destinations and the layout table", () => {
    expect(designSource).toContain(
      "Header destinations: **Library | Sources | Environments | Global | Project**",
    );
    expect(designSource).toMatch(/\|\s*Sources\s*\|/);
  });

  test("SettingsParitySections no longer renders marketplace or publish catalog sections", () => {
    expect(settingsParitySource).not.toContain("MarketplaceSettingsSection");
    expect(settingsParitySource).not.toContain("PublishCatalogsSettings");
    expect(settingsParitySource).toContain("ProjectConfigInspect");
    expect(settingsParitySource).toContain("ResolveOrderSettings");
  });

  test("does not put Plugins or Apply plugin in the header", () => {
    expect(paritySource).not.toContain('aria-label="Plugins"');
    expect(paritySource).not.toContain('aria-label="Apply plugin"');
    expect(paritySource).not.toContain("ApplyPluginDrawer");
    expect(paritySource).toContain('aria-label="Environments"');
  });

  test("labels header destinations Library, Environments, Global, and Project", () => {
    expect(appSource).toMatch(/<Library[\s\S]*\/>\s*Library\s*</);
    expect(paritySource).toMatch(/<Puzzle[\s\S]*\/>\s*Environments\s*</);
    expect(appSource).toMatch(/<Globe[\s\S]*\/>\s*Global\s*</);
    expect(appSource).toMatch(/<FolderGit2[\s\S]*\/>\s*Project\s*</);
    expect(appSource).toContain("header-focus-btn labeled");
    expect(paritySource).toContain("header-focus-btn labeled");
    expect(cssSource).toContain(".header-focus-btn.labeled");
    expect(designSource).toContain("Header destinations: **Library | Environments | Global | Project**");
    expect(designSource).toContain("Header destinations show icon plus name");
  });

  test("refreshes live status after package Apply and shows success in the header", () => {
    const refreshOnProfiles =
      appSource.match(/void refreshProfiles\(\);\s*void refreshStatus\("full"\);/g) ?? [];
    expect(refreshOnProfiles.length).toBeGreaterThanOrEqual(2);
    expect(appSource).toContain("header-status");
    expect(appSource).toContain("success-flash");
  });
});

describe("header re-click home", () => {
  test("classifies header clicks with headerClickIntent", () => {
    expect(appSource).toContain("activeHeaderDestination");
    expect(appSource).toContain("headerClickIntent");
    expect(appSource).toContain("onHeaderDestinationClick");
    expect(appSource).toContain('onClick={() => onHeaderDestinationClick("library")}');
    expect(appSource).toContain('onClick={() => onHeaderDestinationClick("sources")}');
    expect(appSource).toContain('onClick={() => onHeaderDestinationClick("home")}');
    expect(appSource).toContain('onClick={() => onHeaderDestinationClick("project")}');
    expect(appSource).toContain("onHeaderDestinationClick(\"environments\")");
  });

  test("Library, Sources, and Environments re-click bump homeResetNonce", () => {
    expect(appSource).toContain("setHomeResetNonce");
    expect(appSource).toContain("homeResetNonce={homeResetNonce}");
    const resetBlock = sliceBetween(
      appSource,
      'headerClickIntent(activeDestination, clicked) === "reset"',
      "setWorkspaceFocus(\"library\")",
    );
    expect(resetBlock).toContain('case "library"');
    expect(resetBlock).toContain('case "sources"');
    expect(resetBlock).toContain('case "environments"');
  });

  test("Global and Project re-click clear profile search and close edit without changing selection", () => {
    const resetBlock = sliceBetween(
      appSource,
      'headerClickIntent(activeDestination, clicked) === "reset"',
      "navigateToDestination(clicked)",
    );
    expect(resetBlock).toContain('setProfileFilter("")');
    expect(resetBlock).toContain("setEditingProfile(null)");
    expect(resetBlock).not.toContain("setSelectedProfile");
    expect(resetBlock).not.toContain("onSelectView");
    expect(resetBlock).not.toContain("directory: true");
  });

  test("header destinations stay disabled during a profile switch", () => {
    expect(appSource).toContain("disabled={switching}");
    expect(appSource).toContain("disabled={switching || bootstrapBusy}");
  });

  test("Library reset reuses applyFilterChange with default filters", () => {
    expect(resourcesPanelSource).toContain("homeResetNonce");
    expect(resourcesPanelSource).toContain(
      "applyFilterChangeRef.current(defaultResourceFilterState())",
    );
    expect(resourcesPanelSource).toContain(
      "homeResetNonceSeen.current === homeResetNonce",
    );
  });

  test("Environments reset clears the name filter and selection", () => {
    expect(environmentsSource).toContain("homeResetNonce");
    expect(environmentsSource).toContain("homeResetNonceSeen.current === homeResetNonce");
    expect(environmentsSource).toContain('setQuery("")');
    expect(environmentsSource).toContain("setSelectedName(null)");
  });

  test("Environments reset does not close the create/edit panel", () => {
    const effectBlock = sliceBetween(
      environmentsSource,
      "homeResetNonceSeen.current === homeResetNonce",
      "}, [homeResetNonce]);",
    );
    expect(effectBlock).not.toContain("setDrawerOpen");
    expect(effectBlock).not.toContain("setDeleteTarget");
  });

  test("workspace destination switches record screen history", () => {
    expect(appSource).toContain("pushScreenHistory");
    expect(appSource).toContain("popScreenHistory");
    expect(appSource).toContain("canPopScreenHistory");
    expect(appSource).toContain("onWorkspaceBack");
    expect(appSource).toContain("canWorkspaceBack");
    expect(appSource).toContain("WorkspaceBackButton");
    expect(backButtonSource).toContain('data-testid="workspace-back"');
    expect(backButtonSource).toContain("WORKSPACE_BACK_LABEL");
    expect(backButtonSource).toContain("ArrowLeft");
  });

  test("DESIGN.md locks header re-click home", () => {
    expect(designSource).toContain("Re-clicking an already-active header destination");
    expect(designSource).toContain("only switches");
    expect(designSource).toContain("applyFilterChange");
    expect(designSource).toContain("does not reopen the directory picker");
  });
});

describe("desktop full-screen panels", () => {
  test("DESIGN.md uses full-screen panels instead of side drawers", () => {
    expect(designSource).toContain("full-screen panels (not side drawers)");
    expect(designSource).toContain("Create/edit full-screen panel stays if open");
  });

  test("settings and overlay CSS fill the viewport", () => {
    expect(settingsSource).toContain("FullScreenPanel");
    expect(cssSource).toContain(".full-screen-panel {");
    expect(cssSource).not.toContain("place-items: stretch end");
    expect(cssSource).not.toContain("box-shadow: -16px 0 40px");
  });

  test("settings splits sections into labeled tabs", () => {
    expect(settingsSource).toContain('role="tablist"');
    expect(settingsSource).toContain("SETTINGS_TABS");
    expect(settingsSource).toContain("data-testid={`settings-tab-${entry.id}`}");
    expect(settingsTabsSource).toContain('label: "Harnesses"');
    expect(settingsTabsSource).toContain('label: "Marketplaces"');
    expect(settingsTabsSource).toContain('label: "Publish catalogs"');
    expect(settingsTabsSource).toContain('label: "Project"');
    expect(settingsTabsSource).toContain('label: "Advanced"');
    expect(designSource).toContain(
      "Harnesses | Marketplaces | Publish catalogs | Project | Advanced",
    );
  });
});

describe("desktop library workspace", () => {
  test("does not render Items or Packages library tabs", () => {
    expect(appSource).not.toContain("LibraryTab");
    expect(appSource).not.toContain("LibraryWorkspace");
    expect(appSource).toContain("ResourcesPanel");
    expect(appSource).not.toContain('setLibraryTab("packages")');
  });
});
