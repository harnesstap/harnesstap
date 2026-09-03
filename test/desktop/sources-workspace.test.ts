import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const workspaceSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SourcesWorkspace.tsx",
  ),
  "utf8",
);
const pluginDetailSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/PluginPackageDetail.tsx",
  ),
  "utf8",
);
const compositionSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/parity/PluginCompositionFields.tsx",
  ),
  "utf8",
);
const sidebarSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SourceSidebar.tsx",
  ),
  "utf8",
);
const marketplacePanelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/MarketplaceEditPanel.tsx",
  ),
  "utf8",
);
const catalogPanelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ConnectCatalogPanel.tsx",
  ),
  "utf8",
);
const listPaneSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SourcesListPane.tsx",
  ),
  "utf8",
);
const pluginTreeSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SourcesPluginTree.tsx",
  ),
  "utf8",
);
const previewPaneSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SourcesPreviewPane.tsx",
  ),
  "utf8",
);
const recordActionsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/SourcesRecordActions.tsx",
  ),
  "utf8",
);
const sourcesApiSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/lib/api/sources.ts"),
  "utf8",
);
const sourcesSearchSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/lib/sources-search.ts"),
  "utf8",
);
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);

function cssBlock(source: string, selector: string): string {
  const needle = `\n${selector} {`;
  const start = source.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 1);
}

describe("sources workspace chrome", () => {
  test("SourcesWorkspace is rendered from App when workspaceFocus is sources", () => {
    expect(appSource).toContain("SourcesWorkspace");
    expect(appSource).toContain('workspaceFocus === "sources"');
    expect(workspaceSource).toContain("export function SourcesWorkspace");
    expect(workspaceSource).toContain("homeResetNonce");
  });

  test("source sidebar groups checkboxes under Local, Marketplaces, and Cloud", () => {
    expect(sidebarSource).toContain("groupSourceRows");
    expect(sidebarSource).toContain("resource-filter-section-label");
    expect(sidebarSource).toContain("{section.label}");
  });

  test("sidebar Clear filters resets search and default-checked sources", () => {
    expect(sidebarSource).toContain("isSourcesFilterActive");
    expect(sidebarSource).toContain("onClear");
    expect(sidebarSource).toContain('aria-label="Clear filters"');
    expect(sidebarSource).toContain('title="Clear filters"');
    expect(sidebarSource).not.toContain('aria-label="Clear search"');
    expect(sidebarSource).not.toContain("query.trim() === \"\"");
    expect(workspaceSource).toContain("function resetSourcesFilters");
    expect(workspaceSource).toContain("resetSourcesFilters()");
    expect(workspaceSource).toContain("applyListQueryOrChecks(resetSourcesFilters)");
  });

  test("sidebar All sources checkbox selects or clears every source", () => {
    expect(sidebarSource).toContain("onToggleAll");
    expect(sidebarSource).toContain("sourceCheckState");
    expect(sidebarSource).toContain("All sources");
    expect(sidebarSource).toContain('"indeterminate"');
    expect(workspaceSource).toContain("onToggleAll=");
    expect(workspaceSource).toContain("nextCheckedSourceIds");
  });

  test("header cluster uses icon-only Add marketplace and Connect catalog", () => {
    expect(workspaceSource).toContain('label="Add marketplace"');
    expect(workspaceSource).toContain('label="Connect catalog"');
    expect(workspaceSource).toContain("IconActionButton");
  });

  test("places workspace back before the Sources title like Library and Environments", () => {
    expect(workspaceSource).toContain("resources-panel-title-cluster");
    expect(workspaceSource).toContain("WorkspaceBackButton");
    expect(workspaceSource).toContain("<span>Sources</span>");
    expect(appSource).toContain("canWorkspaceBack={canWorkspaceBack}");
    expect(appSource).toContain("onWorkspaceBack={onWorkspaceBack}");
  });

  test("marks the sources shell for tests", () => {
    expect(workspaceSource).toContain('data-testid="sources-workspace"');
  });

  test("plugin-detail Pin plugin still exists", () => {
    expect(pluginDetailSource).toContain("onPin={pinMarketplacePlugin}");
    expect(compositionSource).toContain('label="Pin plugin"');
  });

  test("keeps the marketplace panel open and shows a warning when refresh fails", () => {
    expect(marketplacePanelSource).toContain("marketplaceSubmitCloseAction");
    expect(marketplacePanelSource).toContain('className="banner"');
    expect(marketplacePanelSource).toContain("role=\"status\"");
    expect(marketplacePanelSource).toContain("onListed");
    expect(marketplacePanelSource).toContain("stay-warning");
  });

  test("blocks sidebar search and checks while a confirm is open", () => {
    expect(sidebarSource).toContain("sourcesSidebarChangeAction");
    expect(sidebarSource).toContain("confirmOpen");
    expect(sidebarSource).toContain('"block"');
  });

  test("confirms discard of dirty marketplace and connect-catalog panels", () => {
    expect(marketplacePanelSource).toContain("marketplaceDraftIsDirty");
    expect(marketplacePanelSource).toContain("Discard");
    expect(marketplacePanelSource).toContain("ConfirmDialog");
    expect(catalogPanelSource).toContain("connectCatalogDraftIsDirty");
    expect(catalogPanelSource).toContain("Discard");
    expect(catalogPanelSource).toContain("ConfirmDialog");
  });

  test("connect catalog mode radios use compact option rows, not stretched form-field inputs", () => {
    expect(catalogPanelSource).toContain("resource-filter-section");
    expect(catalogPanelSource).not.toContain(
      'fieldset className="form-field gap-1.5"',
    );
    expect(stylesSource).toContain(
      '.form-field input:not([type="radio"]):not([type="checkbox"])',
    );
  });

  test("sources centered dialogs pin the close control in the header row", () => {
    const header = cssBlock(stylesSource, ".create-profile-header");
    expect(header).toContain("display: flex");
    expect(header).toContain("justify-content: space-between");
  });
});

describe("sources search list and preview", () => {
  test("merges checked sources with mergeSourcesHits and presence badges", () => {
    expect(workspaceSource).toContain("mergeSourcesHits");
    expect(workspaceSource).toContain("fetchLibraryPluginHeads");
    expect(workspaceSource).toContain("fetchLibraryResources");
    expect(workspaceSource).toContain("fetchMarketplacePlugins");
    expect(workspaceSource).toContain("searchCatalogPlugins");
    expect(listPaneSource).toContain("presenceLabel");
    expect(sourcesSearchSource).toContain("In library");
    expect(sourcesSearchSource).toContain("Remote only");
    expect(listPaneSource).toContain('data-testid="sources-list"');
    expect(listPaneSource).toContain("sources-hit-");
    expect(listPaneSource).toContain('data-testid="sources-presence"');
  });

  test("Back and Esc pop the pane stack and dismiss confirm first", () => {
    expect(workspaceSource).toContain("popSourcesPane");
    expect(workspaceSource).toContain("sourcesEscapeAction");
    expect(workspaceSource).toContain("sourcesSidebarChangeAction");
    expect(workspaceSource).toContain('"Escape"');
    expect(pluginTreeSource).toContain("onBack");
    expect(previewPaneSource).toContain("onBack");
  });

  test("searches Cloud catalogs via GET /v1/catalogs/plugins, not profiles/cloud/pull", () => {
    expect(sourcesApiSource).toContain("export async function searchCatalogPlugins");
    expect(sourcesApiSource).toContain("/v1/catalogs/plugins");
    expect(sourcesApiSource).toContain('append("org"');
    expect(sourcesApiSource).toContain('append("registered"');
    expect(workspaceSource).not.toContain("/v1/profiles/cloud/pull");
    expect(sourcesApiSource).not.toContain("/v1/profiles/cloud/pull");
    expect(pluginTreeSource).not.toContain("/v1/profiles/cloud/pull");
    expect(previewPaneSource).not.toContain("/v1/profiles/cloud/pull");
  });

  test("Cloud 401 shows sign-in copy and App can open the account drawer", () => {
    expect(workspaceSource).toContain("onSignIn");
    expect(sourcesApiSource).toContain("AgentApiError");
    expect(workspaceSource).toContain("isCloudAuthError");
    expect(workspaceSource).toContain("isCloudAuthError(installError)");
    expect(workspaceSource).toContain("applyInstallError(pullError");
    expect(workspaceSource).toContain("applyInstallError(pinError");
    expect(recordActionsSource).toContain("SourcesSignInPrompt");
    expect(appSource).toContain("onSignIn=");
    expect(appSource).toContain("setCloudAccountOpen(true)");
    const signInCopy =
      listPaneSource.includes("Sign in from the Cloud account control")
      || pluginTreeSource.includes("Sign in from the Cloud account control")
      || previewPaneSource.includes("Sign in from the Cloud account control")
      || workspaceSource.includes("Sign in from the Cloud account control")
      || recordActionsSource.includes("Sign in from the Cloud account control")
      || recordActionsSource.includes("SourcesSignInPrompt");
    expect(signInCopy).toBe(true);
  });

  test("tree and preview fetches key on pane fields and stable identity, not rebuilt hits", () => {
    expect(workspaceSource).toContain("sourcesHitFetchKey");
    expect(workspaceSource).toContain("pane.mode");
    expect(workspaceSource).toContain("pane.hitId");
    expect(workspaceSource).toContain("pane.filePath");
    expect(workspaceSource).not.toContain("[baseUrl, pane, resolvedHit, token]");
    expect(workspaceSource).toContain("activeHit?.id === pane.hitId");
  });

  test("pulls Cloud plugins via POST /v1/catalogs/plugins/pull, not profiles/cloud/pull", () => {
    expect(sourcesApiSource).toContain("export async function pullCatalogPlugin");
    expect(sourcesApiSource).toContain("/v1/catalogs/plugins/pull");
    expect(sourcesApiSource).not.toContain("/v1/profiles/cloud/pull");
    expect(workspaceSource).toContain("pullCatalogPlugin");
    expect(workspaceSource).not.toContain("/v1/profiles/cloud/pull");
    expect(pluginTreeSource).not.toContain("/v1/profiles/cloud/pull");
    expect(previewPaneSource).not.toContain("/v1/profiles/cloud/pull");
  });

  test("plugin tree and preview expose icon-only Pull, pin/attach, and Open in Library", () => {
    expect(recordActionsSource).toContain('label="Pull"');
    expect(recordActionsSource).toContain('label="Pin to plugin"');
    expect(recordActionsSource).toContain('label="Attach to plugin"');
    expect(recordActionsSource).toContain('label="Open in Library"');
    expect(pluginTreeSource).toContain("SourcesRecordActions");
    expect(previewPaneSource).toContain("SourcesRecordActions");
    expect(workspaceSource).toContain("onOpenInLibrary");
    expect(appSource).toContain("onOpenInLibrary=");
    expect(appSource).toContain("setLibraryFocusPlugin");
  });
});

describe("sources install panels and Cloud browse retirement", () => {
  test("CloudBrowseDrawer is deleted and App does not render Browse Cloud", () => {
    expect(
      existsSync(
        join(
          import.meta.dir,
          "../../apps/desktop/src/components/CloudBrowseDrawer.tsx",
        ),
      ),
    ).toBe(false);
    expect(appSource).not.toContain("CloudBrowseDrawer");
    expect(appSource).not.toContain("Browse Cloud");
    expect(appSource).toContain("CloudAccountDrawer");
  });

  test("Esc closes PinToPluginPanel without treating pinOpen as confirmOpen", () => {
    const pinPanelSource = readFileSync(
      join(
        import.meta.dir,
        "../../apps/desktop/src/components/PinToPluginPanel.tsx",
      ),
      "utf8",
    );
    expect(workspaceSource).not.toContain(
      "sidebarConfirmOpen || marketplaceOpen || catalogOpen || pinOpen",
    );
    expect(workspaceSource).toContain("if (pinOpen)");
    expect(workspaceSource).toContain("setPinOpen(false)");
    expect(pinPanelSource).toContain('"Escape"');
  });

  test("Esc closes marketplace and catalog panels without treating them as confirmOpen", () => {
    expect(marketplacePanelSource).toContain('"Escape"');
    expect(catalogPanelSource).toContain('"Escape"');
    expect(workspaceSource).toContain("if (marketplaceOpen)");
    expect(workspaceSource).toContain("setMarketplaceOpen(false)");
    expect(workspaceSource).toContain("if (catalogOpen)");
    expect(workspaceSource).toContain("setCatalogOpen(false)");
    expect(workspaceSource).not.toContain(
      "sidebarConfirmOpen || marketplaceOpen || catalogOpen",
    );
    expect(workspaceSource).toContain("confirmOpen: sidebarConfirmOpen");
  });

  test("registers Esc on the list pane when overlay panels are open", () => {
    expect(workspaceSource).toContain("sourcesPaneHasPrevious(pane)");
    expect(workspaceSource).toContain(
      "marketplaceOpen || catalogOpen || pinOpen",
    );
  });

  test("retries Cloud search after sign-in", () => {
    expect(appSource).toContain("cloudAuthenticated=");
    expect(appSource).toContain("cloudAuth?.authenticated");
    expect(workspaceSource).toContain("cloudAuthenticated");
    expect(workspaceSource).toContain("setCloudAuthRequired(false)");
    expect(workspaceSource).toContain(
      "[baseUrl, token, query, checkedRows, cloudAuthenticated]",
    );
  });

  test("keeps this-session Cloud pulls in_library until heads refresh", () => {
    expect(workspaceSource).toContain("cloudHitIsInLibrary");
    expect(workspaceSource).toContain("pulledCloudKeys");
  });

  test("pin/attach failure closes the panel and surfaces actionError on the tree", () => {
    const pinConfirm = workspaceSource.slice(
      workspaceSource.indexOf("const onPinConfirm"),
      workspaceSource.indexOf("const recordActionsProps"),
    );
    expect(pinConfirm).toContain("setPinOpen(false)");
    expect(pinConfirm).toContain("setActionError");
    const catchBlock = pinConfirm.slice(pinConfirm.indexOf("catch (pinError"));
    expect(catchBlock).toContain("setPinOpen(false)");
    expect(catchBlock).toContain("Could not update plugin.");
    expect(catchBlock.indexOf("setPinOpen(false)")).toBeLessThan(
      catchBlock.indexOf("applyInstallError"),
    );
  });

  test("PinToPluginPanel lists authored heads only and can create a plugin", () => {
    const pinPanelSource = readFileSync(
      join(
        import.meta.dir,
        "../../apps/desktop/src/components/PinToPluginPanel.tsx",
      ),
      "utf8",
    );
    expect(pinPanelSource).toContain("export function PinToPluginPanel");
    expect(pinPanelSource).toContain('origin === "authored"');
    expect(pinPanelSource).toContain("Create plugin");
    expect(pinPanelSource).toContain("createLibraryPlugin");
    expect(pinPanelSource).not.toContain('origin === "upstream"');
    expect(pinPanelSource).not.toContain('origin === "catalog"');
    expect(workspaceSource).toContain("PinToPluginPanel");
  });

  test("DESIGN.md Sources section locks shell, re-click, cluster, and icon record actions", () => {
    const designSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
      "utf8",
    );
    expect(designSource).toContain("**Sources**");
    expect(designSource).toContain("list XOR plugin-tree XOR preview");
    expect(designSource).toContain("Sources re-click");
    expect(designSource).toContain("Clear filters");
    expect(designSource).toContain("every source checkbox checked");
    expect(designSource).toContain("Add marketplace");
    expect(designSource).toContain("Connect catalog");
    expect(designSource).toContain("Open in Library");
    expect(designSource).toContain("Pin to plugin");
    expect(designSource).toContain("Cloud browse overlay");
    expect(designSource).toContain("Update available");
    expect(designSource).toContain("No Update button on Sources");
    expect(designSource).toContain("Local, Marketplaces, and Cloud");
    expect(designSource).toContain("All sources");
    expect(designSource).toContain("indeterminate");
  });
});

describe("sources origin update badges", () => {
  test("checks origin on mount and badges outdated in-library hits without an Update handler", () => {
    expect(workspaceSource).toContain("fetchPluginOriginCheck");
    expect(workspaceSource).toContain("applyOriginOutdated");
    expect(workspaceSource).toContain("Update available");
    expect(workspaceSource).not.toContain("postPluginOriginUpdate");
    expect(listPaneSource).toContain("Update available");
    expect(listPaneSource).toContain("pill warn");
    expect(pluginTreeSource).toContain("SourcesOriginUpdateBadge");
    expect(previewPaneSource).toContain("SourcesOriginUpdateBadge");
    expect(listPaneSource).toContain("pill warn");
    expect(recordActionsSource).not.toContain("showUpdate");
    expect(recordActionsSource).toContain("Pin to plugin");
  });

  test("clears origin check rows when origin check fails", () => {
    const originCheck = workspaceSource.slice(
      workspaceSource.indexOf("void fetchPluginOriginCheck"),
    );
    const catchStart = originCheck.indexOf(".catch(");
    const catchBody = originCheck.slice(
      catchStart,
      originCheck.indexOf("});", catchStart) + 3,
    );
    expect(catchBody).toContain("setOriginCheckRows([])");
  });
});
