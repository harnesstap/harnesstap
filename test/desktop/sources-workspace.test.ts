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

describe("sources workspace chrome", () => {
  test("SourcesWorkspace is rendered from App when workspaceFocus is sources", () => {
    expect(appSource).toContain("SourcesWorkspace");
    expect(appSource).toContain('workspaceFocus === "sources"');
    expect(workspaceSource).toContain("export function SourcesWorkspace");
    expect(workspaceSource).toContain("homeResetNonce");
  });

  test("header cluster uses Add marketplace and Connect catalog", () => {
    expect(workspaceSource).toContain("Add marketplace");
    expect(workspaceSource).toContain("Connect catalog");
    expect(workspaceSource).toContain('className="btn primary"');
  });

  test("marks the sources shell for tests", () => {
    expect(workspaceSource).toContain('data-testid="sources-workspace"');
  });

  test("plugin-detail Pin plugin still exists", () => {
    expect(pluginDetailSource).toContain("onPin={pinMarketplacePlugin}");
    expect(compositionSource).toContain("Pin plugin");
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

  test("plugin tree and preview expose labeled Pull, pin/attach, and Open in Library", () => {
    expect(recordActionsSource).toContain("Pull");
    expect(recordActionsSource).toContain("Pin to plugin");
    expect(recordActionsSource).toContain("Attach to plugin");
    expect(recordActionsSource).toContain("Open in Library");
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

  test("DESIGN.md Sources section locks shell, re-click, cluster, and labeled record actions", () => {
    const designSource = readFileSync(
      join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
      "utf8",
    );
    expect(designSource).toContain("**Sources**");
    expect(designSource).toContain("list XOR plugin-tree XOR preview");
    expect(designSource).toContain("Sources re-click");
    expect(designSource).toContain("Add marketplace");
    expect(designSource).toContain("Connect catalog");
    expect(designSource).toContain("Open in Library");
    expect(designSource).toContain("Pin to plugin");
    expect(designSource).toContain("Cloud browse overlay");
  });
});
