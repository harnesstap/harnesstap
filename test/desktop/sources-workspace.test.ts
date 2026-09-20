import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopShellSource } from "../helpers/desktop-shell-source";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const appSource = readDesktopShellSource();
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
const stylesSource = readDesktopCss();

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
    expect(appSource).toContain('nav.destination === "discover"');
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
    expect(sidebarSource).toContain('label="Clear filters"');
    expect(sidebarSource).not.toContain('aria-label="Clear search"');
    expect(sidebarSource).not.toContain("query.trim() === \"\"");
    expect(workspaceSource).toContain("function resetSourcesFilters");
    expect(workspaceSource).toContain("resetSourcesFilters()");
    expect(workspaceSource).toContain("applyListQueryOrChecks(resetSourcesFilters)");
    expect(workspaceSource).toContain("setShowInLibrary(false)");
  });

  test("sidebar Show in library is an opt-in checkbox off by default", () => {
    expect(sidebarSource).toContain("Show in library");
    expect(sidebarSource).toContain("id=\"source-show-in-library\"");
    expect(workspaceSource).toContain(
      "const [showInLibrary, setShowInLibrary] = useState(false)",
    );
    expect(workspaceSource).toContain("filterDiscoverGroups");
    expect(workspaceSource).toContain("showInLibrary={showInLibrary}");
    expect(listPaneSource).toContain("discoverListEmptyCopy");
    expect(listPaneSource).toContain('testId="discover-empty"');
    expect(listPaneSource).toContain('className="discover-empty"');
    expect(listPaneSource).toContain("EmptyState");
    expect(listPaneSource).toContain("Clear search");
    expect(workspaceSource).toContain(
      "const [fetchedSourceIds, setFetchedSourceIds] = useState<Set<string>>(",
    );
    expect(workspaceSource).toContain("discoverListIsSearching");
    expect(sourcesSearchSource).toContain("filterDiscoverGroups");
    expect(sourcesSearchSource).toContain('hit.presence !== "in_library"');
    expect(sourcesSearchSource).toContain("You're caught up");
    expect(sourcesSearchSource).toContain("Nothing left to discover.");
    expect(stylesSource).toContain(".sources-workspace .discover-empty");
    expect(stylesSource).toContain("min-height: 12rem");
  });

  test("sidebar All sources checkbox selects or clears every source", () => {
    expect(sidebarSource).toContain("onToggleAll");
    expect(sidebarSource).toContain("sourceCheckState");
    expect(sidebarSource).toContain("All sources");
    expect(sidebarSource).toContain('"indeterminate"');
    expect(workspaceSource).toContain("onToggleAll=");
    expect(workspaceSource).toContain("nextCheckedSourceIds");
    expect(workspaceSource).toContain("nextCheckedSourceIdsForChild");
    expect(sidebarSource).toContain("sourceChildChecked");
    expect(sidebarSource).toContain("source-master-row");
  });

  test("header cluster uses icon-only Add marketplace and Connect catalog", () => {
    expect(workspaceSource).toContain('label="Add marketplace"');
    expect(workspaceSource).toContain('title="Add marketplace"');
    expect(workspaceSource).toContain('label="Connect catalog"');
    expect(workspaceSource).toContain('title="Connect catalog"');
    expect(workspaceSource).toContain("IconActionButton");
    expect(workspaceSource).not.toMatch(
      /label="Add marketplace"[\s\S]{0,400}Add marketplace\s*</,
    );
    expect(workspaceSource).not.toMatch(
      /label="Connect catalog"[\s\S]{0,400}Connect catalog\s*</,
    );
  });

  test("Sources header actions share a larger square than default icon-action chrome", () => {
    expect(stylesSource).toContain("--icon-action-size: 32px");
    expect(stylesSource).toContain("--icon-action-size-lg: 40px");
    const defaultIcon = cssBlock(stylesSource, ".icon-action");
    expect(defaultIcon).toContain("width: var(--icon-action-size)");
    expect(defaultIcon).toContain("height: var(--icon-action-size)");
    const sourcesHeader = cssBlock(
      stylesSource,
      ".sources-workspace .resources-panel-header-actions .icon-action",
    );
    expect(sourcesHeader).toContain("width: var(--icon-action-size-lg)");
    expect(sourcesHeader).toContain("height: var(--icon-action-size-lg)");
    expect(sourcesHeader).toContain("min-width: var(--icon-action-size-lg)");
    expect(sourcesHeader).toContain("min-height: var(--icon-action-size-lg)");
    expect(sourcesHeader).not.toContain("width: auto");
    expect(workspaceSource).toContain("<Store size={20}");
    expect(workspaceSource).toContain("<Cloud size={20}");
    expect(workspaceSource).not.toContain("<Store size={16}");
    expect(workspaceSource).not.toContain("<Cloud size={16}");
  });

  test("places workspace back before the Discover title like Library and Environments", () => {
    expect(workspaceSource).toContain("resources-panel-title-cluster");
    expect(workspaceSource).toContain("WorkspaceBackButton");
    expect(workspaceSource).toContain("<span>Discover</span>");
    expect(workspaceSource).toContain('aria-label="Discover"');
    expect(appSource).toContain("canWorkspaceBack={nav.hasHistory}");
    expect(appSource).toContain("onWorkspaceBack={nav.back}");
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

  test("Discover overlays are full-screen panels, not centered create-profile dialogs", () => {
    expect(marketplacePanelSource).toContain("FullScreenPanel");
    expect(catalogPanelSource).toContain("FullScreenPanel");
    expect(marketplacePanelSource).not.toContain("drawer");
    expect(catalogPanelSource).not.toContain("drawer");
    expect(marketplacePanelSource).not.toContain("create-profile-dialog");
    expect(catalogPanelSource).not.toContain("create-profile-dialog");
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
    expect(workspaceSource).toContain("useEscapeWhenNoLayer(");
    expect(workspaceSource).toContain("Crossfade");
    expect(pluginTreeSource).not.toContain("onBack");
    expect(previewPaneSource).not.toContain("onBack");
    expect(pluginTreeSource).not.toContain("LibraryDetailChrome");
    expect(previewPaneSource).not.toContain("LibraryDetailChrome");
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
    expect(workspaceSource).toContain("applyInstallError(addError");
    expect(workspaceSource).toContain("applyInstallError(confirmError");
    expect(recordActionsSource).toContain("SourcesSignInPrompt");
    expect(appSource).toContain("onSignIn=");
    expect(appSource).toContain('overlays.openOverlay("cloudAccount")');
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
    expect(workspaceSource).toContain("addMarketplacePluginToLibrary");
    expect(workspaceSource).not.toContain("/v1/profiles/cloud/pull");
    expect(pluginTreeSource).not.toContain("/v1/profiles/cloud/pull");
    expect(previewPaneSource).not.toContain("/v1/profiles/cloud/pull");
  });

  test("plugin tree and preview expose labeled Add to Library, pin, and Open in Library", () => {
    expect(recordActionsSource).toContain('label="Add to Library"');
    expect(recordActionsSource).toContain('label="Pin to plugin"');
    expect(recordActionsSource).not.toContain('label="Attach to plugin"');
    expect(recordActionsSource).toContain('label="Open in Library"');
    expect(recordActionsSource).toContain("discover-action-helper");
    expect(pluginTreeSource).toContain("SourcesRecordActions");
    expect(previewPaneSource).toContain("SourcesRecordActions");
    expect(listPaneSource).toContain("ResourceRowRoot");
    expect(listPaneSource).toContain("ResourceRowTrailing");
    expect(listPaneSource).toContain("InUseMark");
    const hitTrailing = cssBlock(stylesSource, ".sources-hit .resource-row-trailing");
    expect(hitTrailing).toContain("align-self: center;");
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
    expect(workspaceSource).toContain("setPinOpen(false)");
    // The panel is its own overlay layer: Esc reaches it, not the list pane.
    expect(pinPanelSource).toContain("FullScreenPanel");
    expect(pinPanelSource).not.toContain("drawer");
    expect(pinPanelSource).not.toContain('addEventListener("keydown"');
  });

  test("Esc closes marketplace and catalog panels without treating them as confirmOpen", () => {
    expect(marketplacePanelSource).toContain("FullScreenPanel");
    expect(catalogPanelSource).toContain("FullScreenPanel");
    expect(marketplacePanelSource).not.toContain('addEventListener("keydown"');
    expect(catalogPanelSource).not.toContain('addEventListener("keydown"');
    expect(workspaceSource).toContain("setMarketplaceOpen(false)");
    expect(workspaceSource).toContain("setEditingMarketplace(null)");
    expect(workspaceSource).toContain("onClose={() => setCatalogOpen(false)}");
    expect(workspaceSource).not.toContain(
      "sidebarConfirmOpen || marketplaceOpen || catalogOpen",
    );
    expect(workspaceSource).toContain("confirmOpen: sidebarConfirmOpen");
  });

  test("Back on Esc only fires on the list pane while no overlay layer is open", () => {
    expect(workspaceSource).toContain("useEscapeWhenNoLayer(");
    expect(workspaceSource).toContain("sourcesPaneHasPrevious(pane),");
    expect(workspaceSource).not.toContain('addEventListener("keydown"');
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

  test("pin/attach failure keeps the panel open and shows the error inline", () => {
    const pinConfirm = workspaceSource.slice(
      workspaceSource.indexOf("const onPinConfirm"),
      workspaceSource.indexOf("const recordActionsProps"),
    );
    expect(pinConfirm).toContain("setPinError");
    const catchBlock = pinConfirm.slice(pinConfirm.indexOf("catch (confirmError"));
    expect(catchBlock).toContain("setPinError");
    expect(catchBlock).toContain("Could not update plugin.");
    expect(catchBlock).not.toContain("setPinOpen(false)");
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
    expect(pinPanelSource).toContain("authored.length > 0");
    expect(pinPanelSource).toContain("sources-pin-create");
    expect(pinPanelSource).not.toContain('origin === "upstream"');
    expect(pinPanelSource).not.toContain('origin === "catalog"');
    expect(workspaceSource).toContain("PinToPluginPanel");
  });

  test("DESIGN.md Discover section locks shell, re-click, cluster, and icon record actions", () => {
    const designSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
      "utf8",
    );
    expect(designSource).toContain("**Discover**");
    expect(designSource).toContain("list XOR plugin-tree XOR preview");
    expect(designSource).toContain("Discover re-click");
    expect(designSource).toContain("Clear filters");
    expect(designSource).toContain("every source checkbox checked");
    expect(designSource).toContain("Show in library");
    expect(designSource).toContain("You're caught up");
    expect(designSource).toContain("Nothing left to discover.");
    expect(designSource).toContain("discover-empty");
    expect(designSource).toContain("Add marketplace");
    expect(designSource).toContain("Connect catalog");
    expect(designSource).toContain("--icon-action-size-lg");
    expect(designSource).toContain("Add to Library");
    expect(designSource).toContain("Pin to plugin");
    expect(designSource).toContain("Create plugin");
    expect(designSource).toContain("No results for");
    expect(designSource).toContain("Clear search");
    expect(designSource).toContain("full-screen panels");
    expect(designSource).toContain("ResourceRowRoot");
    expect(designSource).toContain("InUseMark");
    expect(designSource).toContain("vertically centered in the row");
    expect(designSource).toContain("Cloud browse overlay");
    expect(designSource).toContain("Update available");
    expect(designSource).toContain("No Update button on Discover");
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
    expect(recordActionsSource).toContain("Add to Library");
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
    expect(catchBody).toContain("setOriginCheckError");
    expect(catchBody).not.toContain("setActionError");
  });
});
