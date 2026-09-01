import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  profileStackHasList,
  resolveProfileResourceStack,
} from "../../apps/desktop/src/lib/profile-resource-stack.ts";
import type { ProfileContents } from "../../apps/desktop/src/lib/types.ts";

function contents(
  overrides: Partial<ProfileContents> = {},
): ProfileContents {
  return {
    plugins: [
      {
        id: "teads",
        name: "Teads (Default)",
        version: "1.0.1",
        resources: [
          { type: "skill", name: "ops" },
          { type: "mcp_server", name: "slack" },
        ],
      },
    ],
    stack_resource_count: 2,
    stack_summary: "1 skill, 1 mcp_server",
    type_counts: { plugin: 1, skill: 1, mcp_server: 1 },
    resources: [
      { type: "skill", name: "ops" },
      { type: "mcp_server", name: "slack" },
    ],
    plugin_pins: [{ ref: "slack@claude-plugins", version_constraint: "latest" }],
    mcp_servers: ["slack"],
    ...overrides,
  };
}

const liveDefault = contents({
  plugins: [
    {
      id: "default",
      name: "default",
      version: "1.0.0",
      resources: [{ type: "skill", name: "ship" }],
    },
  ],
  resources: [{ type: "skill", name: "ship" }],
  plugin_pins: [],
  mcp_servers: [],
  type_counts: { plugin: 1, skill: 1 },
  stack_resource_count: 1,
  stack_summary: "1 skill",
});

const empty: ProfileContents = {
  plugins: [],
  stack_resource_count: 0,
  stack_summary: null,
  type_counts: {},
  resources: [],
  plugin_pins: [],
  mcp_servers: [],
};

describe("resolveProfileResourceStack", () => {
  it("lists the selected non-active profile’s full composition, not live overlap", () => {
    const stack = resolveProfileResourceStack({
      selectedProfile: "Teads (Default)",
      activeProfile: "default",
      relativeToActive: false,
      previewMatchesSelection: true,
      liveContents: liveDefault,
      targetContents: contents(),
    });

    expect(stack.kind).toBe("profile");
    expect(stack.contents?.plugins.map((plugin) => plugin.name)).toEqual([
      "Teads (Default)",
    ]);
    expect(profileStackHasList(stack.contents)).toBe(true);
  });

  it("lists live contents when the selected profile is already active", () => {
    const stack = resolveProfileResourceStack({
      selectedProfile: "default",
      activeProfile: "default",
      relativeToActive: true,
      previewMatchesSelection: true,
      liveContents: liveDefault,
      targetContents: liveDefault,
    });

    expect(stack.kind).toBe("live");
    expect(stack.contents).toBe(liveDefault);
  });

  it("keeps showing live contents while the active profile preview is loading", () => {
    const stack = resolveProfileResourceStack({
      selectedProfile: "default",
      activeProfile: "default",
      relativeToActive: false,
      previewMatchesSelection: false,
      liveContents: liveDefault,
      targetContents: null,
    });

    expect(stack.kind).toBe("live");
    expect(stack.contents).toBe(liveDefault);
  });

  it("does not flash the active live stack while a non-active preview loads", () => {
    const stack = resolveProfileResourceStack({
      selectedProfile: "Teads (Default)",
      activeProfile: "default",
      relativeToActive: false,
      previewMatchesSelection: false,
      liveContents: liveDefault,
      targetContents: null,
    });

    expect(stack.kind).toBe("loading");
    expect(stack.contents).toBeNull();
  });

  it("treats a profile with only resources as non-empty", () => {
    expect(
      profileStackHasList(
        contents({
          plugins: [],
          plugin_pins: [],
          resources: [{ type: "skill", name: "ops" }],
        }),
      ),
    ).toBe(true);
    expect(profileStackHasList(empty)).toBe(false);
  });
});

describe("Profile resources pane chrome", () => {
  const liveStateSource = readFileSync(
    join(import.meta.dir, "../../apps/desktop/src/components/LiveStatePanel.tsx"),
    "utf8",
  );
  const appSource = readFileSync(
    join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
    "utf8",
  );
  const designSource = readFileSync(
    join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
    "utf8",
  );

  it("renders the resolved profile stack instead of live/target overlap", () => {
    expect(liveStateSource).toContain("resolveProfileResourceStack");
    expect(liveStateSource).not.toMatch(
      /enabledItems\s*=\s*useLiveEnabledStack\s*\n?\s*\?[\s\S]*?:[\s\S]*?diff\.unchanged/,
    );
  });

  it("offers labeled Add all on Profile resources when not-staged rows exist", () => {
    expect(liveStateSource).toContain("Add all");
    expect(liveStateSource).toContain("onAddAllResources");
    expect(appSource).toContain("onAddAllResources");
  });

  it("locks Profile resources as the selected profile’s composition", () => {
    expect(designSource).toContain(
      "Profile resources lists the selected profile’s composition",
    );
  });

  it("locks not-staged modifications and centered file diffs", () => {
    expect(liveStateSource).toContain("not_staged_kind");
    expect(liveStateSource).toContain("Overwrite profile with the live version");
    expect(designSource).toContain("File apply diffs are the same centered");
    expect(designSource).toContain("live resources that are in the profile but differ");
  });

  it("locks install-gap plus vs warning marks", () => {
    expect(liveStateSource).toContain("installGapRowPresentation");
    expect(designSource).toContain(
      "MCP that is in the profile and not currently installed uses **+**",
    );
  });
});
