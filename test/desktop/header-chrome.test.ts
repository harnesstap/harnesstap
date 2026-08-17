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
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

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

  test("does not put Plugins or Apply plugin in the header", () => {
    expect(paritySource).not.toContain('aria-label="Plugins"');
    expect(paritySource).not.toContain('aria-label="Apply plugin"');
    expect(paritySource).not.toContain("ApplyPluginDrawer");
    expect(paritySource).toContain('aria-label="Environments"');
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
    expect(appSource).toContain('onClick={() => onHeaderDestinationClick("home")}');
    expect(appSource).toContain('onClick={() => onHeaderDestinationClick("project")}');
    expect(appSource).toContain("onHeaderDestinationClick(\"environments\")");
  });

  test("Library and Environments re-click bump homeResetNonce", () => {
    expect(appSource).toContain("setHomeResetNonce");
    expect(appSource).toContain("homeResetNonce={homeResetNonce}");
  });

  test("Global and Project re-click clear profile search and close edit without changing selection", () => {
    const resetBlock = sliceBetween(
      appSource,
      'headerClickIntent(activeDestination, clicked) === "reset"',
      "setWorkspaceFocus(\"library\")",
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

  test("Environments reset does not close the create/edit drawer", () => {
    const effectBlock = sliceBetween(
      environmentsSource,
      "homeResetNonceSeen.current === homeResetNonce",
      "}, [homeResetNonce]);",
    );
    expect(effectBlock).not.toContain("setDrawerOpen");
    expect(effectBlock).not.toContain("setDeleteTarget");
  });

  test("DESIGN.md locks header re-click home", () => {
    expect(designSource).toContain("Re-clicking an already-active header destination");
    expect(designSource).toContain("only switches");
    expect(designSource).toContain("applyFilterChange");
    expect(designSource).toContain("does not reopen the directory picker");
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
