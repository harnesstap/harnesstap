import { describe, expect, it } from "bun:test";
import type { LibraryPluginHead } from "../../apps/desktop/src/lib/api/library-plugins.ts";
import {
  groupLibraryListByFilterType,
  libraryFilterType,
  libraryFilterTypeLabel,
  libraryRowBadge,
  libraryRowUpdateBadge,
  mergeLibraryList,
  type LibraryListEntry,
  type LibraryListKind,
} from "../../apps/desktop/src/lib/library-list.ts";
import type { LibraryResource } from "../../apps/desktop/src/lib/types.ts";

function resource(
  partial: Partial<LibraryResource> &
    Pick<LibraryResource, "id" | "name" | "type">,
): LibraryResource {
  return {
    namespace: null,
    description: null,
    ...partial,
  };
}

const pluginHead: LibraryPluginHead = {
  id: "p1",
  name: "devx",
  version: "1.0.0",
  tags: [],
  description: "Upstream plugin",
  origin: "upstream",
  dirty: false,
  org_slug: "",
  catalog_slug: "",
};

function entryOfKind(
  entries: LibraryListEntry[],
  kind: LibraryListKind,
): LibraryListEntry {
  const found = entries.find((entry) => entry.listKind === kind);
  if (!found) {
    throw new Error(`missing ${kind} row`);
  }
  return found;
}

describe("libraryFilterType", () => {
  it("maps plugin packages to plugin and composition refs to plugin_ref", () => {
    const entries = mergeLibraryList(
      [resource({ id: "r1", type: "plugin", name: "devx@teads-plugins" })],
      [pluginHead],
    );
    expect(libraryFilterType(entryOfKind(entries, "plugin-package"))).toBe(
      "plugin",
    );
    expect(libraryFilterType(entryOfKind(entries, "resource"))).toBe(
      "plugin_ref",
    );
    expect(
      libraryFilterType(resource({ id: "s", type: "skill", name: "ship" })),
    ).toBe("skill");
  });

  it("labels plugin_ref as plugin ref", () => {
    expect(libraryFilterTypeLabel("plugin_ref")).toBe("plugin ref");
    expect(libraryFilterTypeLabel("plugin")).toBe("plugin");
    expect(libraryFilterTypeLabel("mcp_server")).toBe("mcp_server");
  });
});

describe("groupLibraryListByFilterType", () => {
  it("splits plugin packages and plugin refs into separate groups", () => {
    const entries = mergeLibraryList(
      [
        resource({ id: "r1", type: "plugin", name: "zeta-ref" }),
        resource({ id: "r2", type: "skill", name: "ship" }),
        resource({ id: "r3", type: "plugin", name: "alpha-ref" }),
      ],
      [pluginHead],
    );
    const groups = groupLibraryListByFilterType(entries);
    expect(groups.map((group) => group.type)).toEqual([
      "plugin",
      "plugin_ref",
      "skill",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "plugin",
      "plugin ref",
      "skill",
    ]);
    expect(groups[0]?.resources.map((row) => row.name)).toEqual(["devx"]);
    expect(groups[1]?.resources.map((row) => row.name)).toEqual([
      "alpha-ref",
      "zeta-ref",
    ]);
  });
});

describe("libraryRowBadge", () => {
  it("keeps version on packages and plugin ref on composition rows", () => {
    const entries = mergeLibraryList(
      [resource({ id: "r1", type: "plugin", name: "nested" })],
      [pluginHead],
    );
    expect(libraryRowBadge(entryOfKind(entries, "plugin-package"))).toBe(
      "1.0.0",
    );
    expect(libraryRowBadge(entryOfKind(entries, "resource"))).toBe("plugin ref");
  });
});

describe("libraryRowUpdateBadge", () => {
  it("returns Update available only for outdated plugin-package rows", () => {
    const entries = mergeLibraryList(
      [resource({ id: "r1", type: "plugin", name: "nested" })],
      [pluginHead],
      new Set(["p1"]),
    );
    expect(libraryRowUpdateBadge(entryOfKind(entries, "plugin-package"))).toBe(
      "Update available",
    );
    expect(libraryRowUpdateBadge(entryOfKind(entries, "resource"))).toBe(null);
    const current = mergeLibraryList([], [pluginHead]);
    expect(libraryRowUpdateBadge(current[0]!)).toBe(null);
  });
});

