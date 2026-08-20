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
