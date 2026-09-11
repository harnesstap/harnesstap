import { describe, expect, it } from "bun:test";
import {
  compareCompositionGroupTypes,
  groupCompositionMembership,
  mergeCompositionMembership,
} from "../../apps/desktop/src/lib/composition-membership.ts";
import type { LibraryPlugin, LibraryResource } from "../../apps/desktop/src/lib/types.ts";

function resource(
  partial: Partial<LibraryResource> & Pick<LibraryResource, "id" | "name" | "type">,
): LibraryResource {
  return {
    namespace: null,
    description: null,
    ...partial,
  };
}

const plugins: LibraryPlugin[] = [
  {
    id: "pkg-1",
    name: "superpowers",
    version: "1.0.0",
    tags: [],
    description: "Upstream plugin superpowers@obra",
  },
  {
    id: "profile-1",
    name: "focus",
    version: "0.1.0",
    tags: ["profile"],
    description: "A profile",
  },
];

describe("mergeCompositionMembership", () => {
  it("keeps plugin packages and plugin refs in one list", () => {
    const entries = mergeCompositionMembership(
      [
        resource({
          id: "ref-1",
          type: "plugin",
          name: "ponytail",
          namespace: "ponytail",
          description: "Lazy senior dev mode",
        }),
        resource({ id: "skill-1", type: "skill", name: "ship" }),
      ],
      plugins,
      { excludePluginName: "focus", excludeProfileTagged: true },
    );
    expect(entries.some((entry) => entry.listKind === "plugin-package" && entry.name === "superpowers")).toBe(true);
    expect(entries.some((entry) => entry.listKind === "plugin-package" && entry.name === "focus")).toBe(false);
    const ponytail = entries.find((entry) => entry.id === "ref-1");
    expect(ponytail?.type).toBe("plugin");
    expect(ponytail?.listKind).toBe("resource");
  });
});

describe("groupCompositionMembership", () => {
  it("puts plugin and plugin ref groups first", () => {
    const groups = groupCompositionMembership(
      mergeCompositionMembership(
        [
          resource({ id: "s", type: "skill", name: "ship" }),
          resource({
            id: "ref-1",
            type: "plugin",
            name: "ponytail",
            namespace: "ponytail",
          }),
          resource({ id: "a", type: "agent", name: "reviewer" }),
        ],
        plugins,
        { excludeProfileTagged: true },
      ),
    );
    expect(groups.map((group) => group.type)).toEqual([
      "plugin",
      "plugin_ref",
      "agent",
      "skill",
    ]);
    expect(groups[1]?.label).toBe("Plugin refs");
    expect(groups[1]?.resources.map((row) => row.name)).toEqual(["ponytail"]);
  });
});

describe("compareCompositionGroupTypes", () => {
  it("orders plugin before plugin_ref before other types", () => {
    expect(compareCompositionGroupTypes("plugin", "skill")).toBeLessThan(0);
    expect(compareCompositionGroupTypes("plugin_ref", "agent")).toBeLessThan(0);
    expect(compareCompositionGroupTypes("plugin", "plugin_ref")).toBeLessThan(0);
  });
});
