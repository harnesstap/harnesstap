import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  isPluginRefRow,
  libraryRowBadge,
  mergeLibraryList,
  type LibraryListEntry,
} from "../../apps/desktop/src/lib/library-list.ts";
import { applyLibraryResourceFilters, defaultResourceFilterState } from "../../apps/desktop/src/lib/resource-filters.ts";
import type { LibraryPluginHead } from "../../apps/desktop/src/lib/api/library-plugins.ts";
import type { LibraryResource } from "../../apps/desktop/src/lib/types.ts";

const panelSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ResourcesPanel.tsx"),
  "utf8",
);

const skill: LibraryResource = {
  id: "res-1",
  name: "guide",
  type: "skill",
  namespace: "ns",
  description: "A skill",
};

const pluginRef: LibraryResource = {
  id: "res-2",
  name: "baseline",
  type: "plugin",
  namespace: null,
  description: "nested plugin ref",
};

const head: LibraryPluginHead = {
  id: "pkg-1",
  name: "eng",
  version: "1.2.0",
  tags: ["profile", "team"],
  description: "Engineering",
  origin: "authored",
  dirty: true,
};

describe("mergeLibraryList", () => {
  test("adds plugin packages as plugin type rows beside resources", () => {
    const rows = mergeLibraryList([skill, pluginRef], [head]);
    expect(rows.map((row) => row.id).sort()).toEqual(["pkg-1", "res-1", "res-2"]);
    const pkg = rows.find((row) => row.id === "pkg-1") as LibraryListEntry;
    expect(pkg.listKind).toBe("plugin-package");
    expect(pkg.type).toBe("plugin");
    expect(pkg.origin_kind).toBeNull();
  });

  test("labels composition refs as plugin ref and packages with version", () => {
    const rows = mergeLibraryList([pluginRef], [head]);
    const ref = rows.find((row) => row.id === "res-2") as LibraryListEntry;
    const pkg = rows.find((row) => row.id === "pkg-1") as LibraryListEntry;
    expect(isPluginRefRow(ref)).toBe(true);
    expect(isPluginRefRow(pkg)).toBe(false);
    expect(libraryRowBadge(ref)).toBe("plugin ref");
    expect(libraryRowBadge(pkg)).toBe("1.2.0*");
  });

  test("type filter plugin includes packages and refs; origin filter drops packages", () => {
    const rows = mergeLibraryList([skill, pluginRef], [head]);
    const pluginOnly = applyLibraryResourceFilters(rows, {
      ...defaultResourceFilterState(),
      type: "plugin",
    });
    expect(pluginOnly.map((row) => row.id).sort()).toEqual(["pkg-1", "res-2"]);
    const localOnly = applyLibraryResourceFilters(rows, {
      ...defaultResourceFilterState(),
      originKind: "local",
    });
    expect(localOnly.map((row) => row.id)).toEqual([]);
  });

  test("search matches plugin package tags", () => {
    const rows = mergeLibraryList([], [head]);
    const hits = applyLibraryResourceFilters(rows, {
      ...defaultResourceFilterState(),
      search: "team",
    });
    expect(hits.map((row) => row.id)).toEqual(["pkg-1"]);
  });
});

test("ResourcesPanel merges plugin heads into the list", () => {
  expect(panelSource).toContain("mergeLibraryList");
  expect(panelSource).toContain("fetchLibraryPluginHeads");
  expect(panelSource).toContain("libraryRowBadge");
});

test("library resource detail is a pane, not a library modal", () => {
  expect(panelSource).toContain("LibraryDetailChrome");
  expect(panelSource).toContain("ResourceDetailBody");
  expect(panelSource).not.toContain("ResourceDetailPane");
});

test("ResourcesPanel opens plugin packages in PluginPackageDetail", () => {
  expect(panelSource).toContain("PluginPackageDetail");
  expect(panelSource).not.toContain("PluginsWorkspace");
});

test("create plugin is a local draft until name commit", () => {
  expect(panelSource).toContain("createLibraryPlugin");
  expect(panelSource).toContain("Discard this plugin?");
  expect(panelSource).toContain("draftHasTypedContent");
  expect(panelSource).toContain("PluginCreateDraft");
});

test("leaving a create draft does not post the typed name", () => {
  const draftSource = readFileSync(
    join(
      import.meta.dir,
      "../../apps/desktop/src/components/PluginCreateDraft.tsx",
    ),
    "utf8",
  );
  const chromeSource = readFileSync(
    join(
      import.meta.dir,
      "../../apps/desktop/src/components/LibraryDetailChrome.tsx",
    ),
    "utf8",
  );
  expect(panelSource).toContain("shouldCommitDraftName");
  expect(panelSource).toContain("onPointerDownCapture");
  expect(panelSource).toMatch(/mode === "create-draft"[\s\S]*suppressDraftCommitRef/);
  expect(draftSource).not.toContain("setTimeout");
  expect(draftSource).toContain("relatedTarget");
  expect(chromeSource).toContain("onBackPointerDown");
  expect(panelSource).toContain("draftGeneration");
  expect(panelSource).toMatch(/<PluginCreateDraft[\s\S]*key=\{draftGeneration\}/);
});

test("starting another field commits the open field first", () => {
  const bodySource = readFileSync(
    join(
      import.meta.dir,
      "../../apps/desktop/src/components/ResourceDetailBody.tsx",
    ),
    "utf8",
  );
  expect(bodySource).toMatch(/await commitField\(/);
});

test("LiveState and Stash resource detail remains a dialog", () => {
  const paneSource = readFileSync(
    join(import.meta.dir, "../../apps/desktop/src/components/ResourceDetailPane.tsx"),
    "utf8",
  );
  expect(paneSource).toContain("aria-modal");
});
