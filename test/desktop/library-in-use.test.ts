import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  indexLibraryInUse,
  libraryInUseEntryKeys,
  libraryInUseForEntry,
  libraryInUseKind,
  libraryInUseMemberKeysFromDetail,
  libraryInUseTooltip,
  uniqueLibraryInUseProjectPaths,
} from "../../apps/desktop/src/lib/library-in-use.ts";
import type { LibraryListEntry } from "../../apps/desktop/src/lib/library-list.ts";
import type { ProfileDetail } from "../../apps/desktop/src/lib/types.ts";

const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourcesPanel.tsx",
  ),
  "utf8",
);
const markSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/LibraryInUseMark.tsx",
  ),
  "utf8",
);

function detail(partial: {
  name: string;
  resources?: ProfileDetail["resources"];
  dependencies?: ProfileDetail["dependencies"];
}): ProfileDetail {
  return {
    profile: {
      id: `id-${partial.name}`,
      name: partial.name,
      version: "1.0.0",
      description: "",
      tags: ["profile"],
    },
    active: false,
    dependencies: partial.dependencies ?? [],
    resources: partial.resources ?? [],
  };
}

function resourceEntry(
  partial: Pick<LibraryListEntry, "id" | "name" | "type"> &
    Partial<LibraryListEntry>,
): LibraryListEntry {
  return {
    namespace: null,
    description: null,
    listKind: "resource",
    ...partial,
  };
}

function pluginEntry(
  partial: Pick<LibraryListEntry, "id" | "name">,
): LibraryListEntry {
  return {
    id: partial.id,
    name: partial.name,
    type: "plugin",
    namespace: null,
    description: null,
    listKind: "plugin-package",
  };
}

const unused = { onGlobal: false, projectCount: 0 };
const projectOne = { onGlobal: false, projectCount: 1 };
const projectTwo = { onGlobal: false, projectCount: 2 };
const globalOnly = { onGlobal: true, projectCount: 0 };
const bothTwo = { onGlobal: true, projectCount: 2 };

describe("libraryInUseKind", () => {
  it("maps the four membership states", () => {
    expect(libraryInUseKind(unused)).toBe("none");
    expect(libraryInUseKind(projectOne)).toBe("project");
    expect(libraryInUseKind(globalOnly)).toBe("global");
    expect(libraryInUseKind(bothTwo)).toBe("both");
  });
});

describe("libraryInUseTooltip", () => {
  it("returns null for unused", () => {
    expect(libraryInUseTooltip(unused)).toBe(null);
  });

  it("pluralizes project-only copy", () => {
    expect(libraryInUseTooltip(projectOne)).toBe("In 1 project");
    expect(libraryInUseTooltip(projectTwo)).toBe("In 2 projects");
  });

  it("uses On Global for global-only", () => {
    expect(libraryInUseTooltip(globalOnly)).toBe("On Global");
  });

  it("joins both with a middle dot and lowercase in", () => {
    expect(libraryInUseTooltip({ onGlobal: true, projectCount: 1 })).toBe(
      "On Global · in 1 project",
    );
    expect(libraryInUseTooltip(bothTwo)).toBe("On Global · in 2 projects");
  });
});

describe("indexLibraryInUse", () => {
  it("leaves unused rows empty", () => {
    const index = indexLibraryInUse({
      profiles: [{ name: "global default", scopes: ["home"] }],
      compositions: [
        {
          profileName: "global default",
          memberKeys: libraryInUseMemberKeysFromDetail(
            detail({
              name: "global default",
              resources: [
                { id: "skill-used", type: "skill", name: "ship", source: "" },
              ],
            }),
          ),
        },
      ],
      projectBindings: [],
    });
    const unusedRow = resourceEntry({
      id: "skill-idle",
      name: "idle",
      type: "skill",
    });
    expect(libraryInUseForEntry(unusedRow, index)).toEqual(unused);
    expect(libraryInUseKind(libraryInUseForEntry(unusedRow, index))).toBe("none");
  });

  it("counts distinct project paths for project-only membership", () => {
    const members = libraryInUseMemberKeysFromDetail(
      detail({
        name: "project default",
        resources: [{ id: "r1", type: "skill", name: "ship", source: "" }],
      }),
    );
    const index = indexLibraryInUse({
      profiles: [{ name: "project default", scopes: ["project"] }],
      compositions: [{ profileName: "project default", memberKeys: members }],
      projectBindings: [
        { path: "/proj-a", profileNames: ["project default"] },
        { path: "/proj-b", profileNames: ["project default"] },
      ],
    });
    const entry = resourceEntry({ id: "r1", name: "ship", type: "skill" });
    expect(libraryInUseForEntry(entry, index)).toEqual({
      onGlobal: false,
      projectCount: 2,
    });
    expect(libraryInUseTooltip(libraryInUseForEntry(entry, index))).toBe(
      "In 2 projects",
    );
  });

  it("marks Global-only from home-scoped composition including plugin packages", () => {
    const members = libraryInUseMemberKeysFromDetail(
      detail({
        name: "global default",
        dependencies: [
          {
            dependency_name: "superpowers",
            version_constraint: "*",
            order: 0,
            resource_id: "pkg-1",
          },
        ],
      }),
    );
    const index = indexLibraryInUse({
      profiles: [{ name: "global default", scopes: ["home"] }],
      compositions: [{ profileName: "global default", memberKeys: members }],
      projectBindings: [],
    });
    const entry = pluginEntry({ id: "pkg-1", name: "superpowers" });
    expect(libraryInUseEntryKeys(entry)).toContain("plugin:superpowers");
    expect(libraryInUseForEntry(entry, index)).toEqual({
      onGlobal: true,
      projectCount: 0,
    });
    expect(libraryInUseTooltip(libraryInUseForEntry(entry, index))).toBe(
      "On Global",
    );
  });

  it("combines Global and project hits as both", () => {
    const skill = { id: "r1", type: "skill", name: "ship", source: "" };
    const index = indexLibraryInUse({
      profiles: [
        { name: "global default", scopes: ["home"] },
        { name: "project default", scopes: ["project"] },
      ],
      compositions: [
        {
          profileName: "global default",
          memberKeys: libraryInUseMemberKeysFromDetail(
            detail({ name: "global default", resources: [skill] }),
          ),
        },
        {
          profileName: "project default",
          memberKeys: libraryInUseMemberKeysFromDetail(
            detail({ name: "project default", resources: [skill] }),
          ),
        },
      ],
      projectBindings: [
        { path: "/proj-a", profileNames: ["project default"] },
      ],
    });
    const entry = resourceEntry({ id: "r1", name: "ship", type: "skill" });
    expect(libraryInUseForEntry(entry, index)).toEqual({
      onGlobal: true,
      projectCount: 1,
    });
    expect(libraryInUseTooltip(libraryInUseForEntry(entry, index))).toBe(
      "On Global · in 1 project",
    );
  });
});

describe("uniqueLibraryInUseProjectPaths", () => {
  it("dedupes the current path and recents", () => {
    expect(
      uniqueLibraryInUseProjectPaths("/proj-a", ["/proj-a", "/proj-b", ""]),
    ).toEqual(["/proj-a", "/proj-b"]);
  });
});

describe("library in-use chrome", () => {
  it("documents the four trailing marks", () => {
    expect(designSource).toContain("Library list rows trail an in-use mark");
    expect(designSource).toContain("**In 1 project** / **In N projects**");
    expect(designSource).toContain("**On Global · in N projects**");
    expect(designSource).toContain("No unused-only filter yet");
  });

  it("wires IconActionButton marks onto Library list trailing chrome", () => {
    expect(panelSource).toContain("LibraryInUseMark");
    expect(panelSource).toContain("ResourceRowTrailing");
    expect(panelSource).toContain("libraryInUseForEntry");
    expect(markSource).toContain("IconActionButton");
    expect(markSource).toContain("library-in-use-mark");
  });
});
