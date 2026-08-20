import { readFileSync } from "node:fs";
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
    expect(appSource).toContain("onSignIn=");
    expect(appSource).toContain("setCloudAccountOpen(true)");
    const signInCopy =
      listPaneSource.includes("Sign in from the Cloud account control")
      || pluginTreeSource.includes("Sign in from the Cloud account control")
      || previewPaneSource.includes("Sign in from the Cloud account control")
      || workspaceSource.includes("Sign in from the Cloud account control");
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
});
