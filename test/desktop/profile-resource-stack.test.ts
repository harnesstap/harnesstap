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

  it("offers labeled Add all on the Not staged header and demotes it when Re-apply is primary", () => {
    const notStagedHeader = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Not staged"'),
      liveStateSource.indexOf("placeholder=\"Filter by name\""),
    );
    const profileResourcesHeader = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Profile resources"'),
      liveStateSource.indexOf('aria-label="Not staged"'),
    );
    expect(notStagedHeader).toContain('label="Add all"');
    expect(notStagedHeader).toContain("primary={!railPrimaryIsReapply}");
    expect(notStagedHeader).toContain("showLabel");
    expect(notStagedHeader).toContain("iconAfterLabel");
    expect(notStagedHeader).toContain("onAddAllResources");
    expect(profileResourcesHeader).not.toContain('label="Add all"');
    expect(appSource).toContain("onAddAllResources");
    expect(appSource).toContain("railPrimaryIsReapply={showReapply}");
  });

  it("locks Profile resources as the selected profile’s composition", () => {
    expect(designSource).toContain(
      "Profile resources lists the selected profile’s composition",
    );
    expect(designSource).toContain(
      "ResourceTypeTabs filter that inventory as a flat list",
    );
    expect(designSource).not.toContain(
      "Profile resources stay a nested plugin composition tree",
    );
  });

  it("uses ResourceTypeTabs over a flat list and keeps plugin membership on nested rows", () => {
    const profileResources = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Profile resources"'),
      liveStateSource.indexOf('aria-label="Not staged"'),
    );
    expect(profileResources).toContain("ResourceTypeTabs");
    expect(profileResources).toContain("countResourceTypeTabs");
    expect(profileResources).toContain("ProfileResourceListItem");
    expect(liveStateSource).toContain("flattenProfileResourceList");
    expect(profileResources).not.toContain("EnabledPluginGroup");
    expect(profileResources).not.toContain("enabled-plugin-summary");
    expect(profileResources).not.toContain("resources-type-heading");
    expect(profileResources).not.toContain("resource-filter-type-badge");
    expect(profileResources).not.toContain("Sparkles");
    expect(liveStateSource).toContain("pluginId={row.pluginId}");
    expect(liveStateSource).toContain("in {pluginName}");
    expect(designSource).toContain("detach `pluginId`");
  });

  it("locks not-staged modifications and centered file diffs", () => {
    expect(liveStateSource).toContain("not_staged_kind");
    expect(liveStateSource).toContain("Replace profile copy of");
    expect(liveStateSource).toContain('const NOT_STAGED_SUBTITLE = "On disk, not in this profile"');
    expect(liveStateSource).not.toContain("(or different)");
    expect(designSource).toContain("On disk, not in this profile");
    expect(liveStateSource).toContain("not-staged-attention");
    expect(liveStateSource).toContain('label="Add"');
    expect(designSource).toContain("File apply diffs are the same centered");
    expect(designSource).toContain("live resources that are in the profile but differ");
    expect(designSource).toContain("`--yellow` warn surface");
    expect(designSource).toContain("Target preview does not use that amber tint");
  });

  it("collapses Not staged help into a header info tooltip and omits the on-disk count", () => {
    const notStagedHeader = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Not staged"'),
      liveStateSource.indexOf("placeholder=\"Filter by name\""),
    );
    expect(liveStateSource).toContain("contents-header-info");
    expect(liveStateSource).toContain("text={NOT_STAGED_HELP}");
    expect(liveStateSource).toContain("NOT_STAGED_SUBTITLE");
    expect(notStagedHeader).not.toContain("on disk");
    expect(liveStateSource).not.toContain("untracked-hint");
    expect(designSource).toContain("in the Not staged panel header");
    expect(designSource).toContain("info icon next to the **Not staged** title");
  });

  it("locks install-gap plus vs warning marks", () => {
    expect(liveStateSource).toContain("installGapRowPresentation");
    expect(liveStateSource).toContain("groupInstallGaps");
    expect(liveStateSource).not.toContain("already active");
    expect(designSource).toContain(
      "MCP that is in the profile and not currently installed uses **+**",
    );
    expect(designSource).toContain(
      "Missing-plugin rows use icon-only **Install**",
    );
    expect(designSource).toContain("tooltip and accessible name **Install {plugin}**");
    expect(liveStateSource).toContain("installGapStatusLabel");
    expect(liveStateSource).toContain("not-staged-status-glyph");
    expect(designSource).toContain("status glyph, not Sparkles");
    expect(liveStateSource).not.toContain("active · drifting");
  });

  it("uses a quiet empty Target preview without header profile name or empty panels", () => {
    const previewBlock = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Target preview"'),
      liveStateSource.indexOf("<ResourceDetailPane"),
    );
    const header = previewBlock.slice(
      previewBlock.indexOf("<summary"),
      previewBlock.indexOf("</summary>"),
    );
    expect(previewBlock).toContain("TargetPreviewQuietEmpty");
    expect(previewBlock).toContain("targetPreviewQuietEmpty");
    expect(liveStateSource).toContain("function TargetPreviewQuietEmpty");
    expect(liveStateSource).toContain("<p>no changes</p>");
    expect(liveStateSource).toContain("target-preview-quiet-empty");
    expect(liveStateSource).toContain("target-preview-quiet-empty-icon");
    expect(header).toContain("Target preview");
    expect(header).not.toContain("contents-header-meta");
    expect(header).not.toContain("selectedProfile");
    expect(previewBlock).not.toContain("No stack changes");
    expect(previewBlock).not.toContain("No file changes vs live target");
    expect(previewBlock).not.toContain("is-disabled");
    expect(liveStateSource).not.toContain("target-preview-drift-glyph");
    expect(designSource).toContain("chevron only");
    expect(designSource).toContain("**no changes**");
    expect(designSource).toContain("deactivated grey, not accent");
    expect(designSource).toContain("Stack and file panels appear only when they have rows");
  });
});
