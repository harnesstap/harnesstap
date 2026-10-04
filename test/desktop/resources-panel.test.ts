import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourcesPanel.tsx",
  ),
  "utf8",
);

describe("ResourcesPanel library snapshot", () => {
  test("paints the list from the session snapshot instead of list-load fetches", () => {
    expect(panelSource).not.toContain("fetchLibraryResources(baseUrl, token)");
    expect(panelSource).not.toContain("fetchLibraryPluginHeads");
    expect(panelSource).toContain("librarySnapshotStore.loadFull");
    expect(panelSource).toContain("useLibrarySnapshotStore");
    expect(panelSource).toContain("visibleLibraryRows");
  });

  test("debounces agent search at 250ms", () => {
    expect(panelSource).toContain("LIBRARY_SEARCH_DEBOUNCE_MS = 250");
    expect(panelSource).toContain("librarySnapshotStore.search");
    expect(panelSource).toContain("new AbortController()");
    expect(panelSource).toContain(
      "type: typeTab === ALL_RESOURCE_TYPE_TAB ? null : typeTab",
    );
  });

  test("checks plugin origin without forcing refresh", () => {
    expect(panelSource).toContain("fetchPluginOriginCheck(baseUrl, token)");
    expect(panelSource).not.toContain(
      "fetchPluginOriginCheck(baseUrl, token, { refresh: true })",
    );
  });
});
