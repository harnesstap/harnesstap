import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { promptForInteractiveCatalogBrowser } from "../../src/services/wizards/interactive-catalog-browser.ts?actual";
import { promptForInteractiveCatalogSearch } from "../../src/services/wizards/interactive-catalog-search.ts?actual";
import { promptForInteractiveResourceList } from "../../src/services/wizards/interactive-resource-list.ts?actual";
import { promptForSearchableMultiSelect } from "../../src/services/wizards/searchable-multi-select.ts?actual";

const sampleResources = [
  {
    id: "skill-1",
    type: "skill",
    name: "shared-skill",
    namespace: "",
    display_name: "shared-skill",
    description: "Shared helper",
    source: "manual",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    content: "# Shared",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
] as const;

const sampleLayers: CatalogLayer[] = [
  {
    orgSlug: "harnessdeck-cloud",
    catalogSlug: "default",
    slug: "fullstack",
    name: "Fullstack",
    summary: "Fullstack baseline",
    latestVersion: "1.0.0",
    updatedAt: "2026-01-03T00:00:00.000Z",
    tags: ["baseline"],
    visibility: "public",
  },
];

describe("interactive list keyboard contract", () => {
  it("resource list shows esc exit (not esc cancel)", async () => {
    const { getScreen } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [...sampleResources],
      },
      { clearPromptOnDone: true },
    );

    const frame = getScreen();
    expect(frame).toContain("esc exit");
    expect(frame).not.toContain("esc cancel");
  });

  it("catalog browser shows esc cancel", async () => {
    const { getScreen, nextRender } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog layers to install",
        scopeLabel: "harnessdeck-cloud",
        listLayers: async () => sampleLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    expect(getScreen()).toContain("esc cancel");
  });

  it("searchable multi-select shows esc back", async () => {
    const { getScreen } = await render(
      promptForSearchableMultiSelect,
      {
        message: "Select alias harnesses",
        choices: [
          { name: "Claude Code", value: "claude-code" },
          { name: "Cursor", value: "cursor" },
        ],
      },
      { clearPromptOnDone: true },
    );

    expect(getScreen()).toContain("esc back");
  });

  it("catalog search apply mode shows ctrl+s and esc cancel", async () => {
    const { getScreen, nextRender } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog layers to apply",
        scopeLabel: "harnessdeck-cloud",
        initialQuery: "fullstack",
        listLayers: async () => sampleLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    const frame = getScreen();
    expect(frame).toContain("ctrl+s");
    expect(frame).toContain("esc cancel");
  });
});
