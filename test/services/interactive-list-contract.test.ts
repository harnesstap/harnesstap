import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import { promptForInteractiveCatalogBrowser } from "../../src/services/wizards/interactive-catalog-browser.ts?actual";
import { promptForInteractiveCatalogSearch } from "../../src/services/wizards/interactive-catalog-search.ts?actual";
import { promptForInteractiveEnvironmentList } from "../../src/services/wizards/interactive-environment-list.ts?actual";
import { promptForInteractivePluginListBrowse } from "../../src/services/wizards/interactive-plugin-list-browse.ts?actual";
import { promptForInteractiveResourceList } from "../../src/services/wizards/interactive-resource-list.ts?actual";
import { promptForSearchableMultiSelect } from "../../src/services/wizards/searchable-multi-select.ts?actual";
import type { EnvironmentListRow } from "../../src/ui/environment-list-render.ts";
import type { Plugin } from "../../src/types.js";

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

function makeOverflowResources() {
  const skills = Array.from({ length: 6 }, (_, index) => ({
    id: `skill-${index + 1}`,
    type: "skill" as const,
    name: `skill-${index + 1}`,
    namespace: "",
    display_name: `skill-${index + 1}`,
    description: "Skill row",
    source: "manual" as const,
    origin_kind: "manual" as const,
    origin_ref: "",
    content_hash: "",
    content: "# Skill",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }));
  return [
    ...skills,
    {
      id: "rule-1",
      type: "rule" as const,
      name: "rule-1",
      namespace: "",
      display_name: "rule-1",
      description: "Rule row",
      source: "manual" as const,
      origin_kind: "manual" as const,
      origin_ref: "",
      content_hash: "",
      content: "# Rule",
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  ];
}

function makeEnvironmentRow(name: string): EnvironmentListRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    environment: {
      id: `env-${name}`,
      name,
      description: `${name} environment`,
      created_at: now,
      updated_at: now,
    },
    value_count: 1,
    secret_ref_count: 0,
    reference_count: 0,
  };
}

const samplePlugins: CatalogPlugin[] = [
  {
    orgSlug: "harnesstap-cloud",
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

const localPlugins: Plugin[] = [
  {
    id: "plugin-1",
    name: "team-stack",
    version: "1.0.0",
    org_slug: "",
    catalog_slug: "",
    description: "Installed locally",
    tags: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
];

function overflowHintLines(frame: string): string[] {
  return frame.split("\n").filter((line) =>
    line.includes("above") || line.includes("next type") || line.includes("more in"),
  );
}

function expectNoSelectionLine(frame: string): void {
  expect(frame).not.toMatch(/\nShow: /);
  expect(frame).not.toMatch(/\nActive: /);
}

describe("interactive list keyboard contract", () => {
  promptIt("resource list shows esc exit (not esc cancel)", async () => {
    await withPrompt(
      render(
        promptForInteractiveResourceList,
        {
          message: "Filter resources",
          resources: [...sampleResources],
        },
        { clearPromptOnDone: true },
      ),
      ({ getScreen }) => {
        const frame = getScreen();
        expect(frame).toContain("esc exit");
        expect(frame).not.toContain("esc cancel");
        expectNoSelectionLine(frame);
      },
    );
  });

  promptIt("resource list footer folds overflow hints", async () => {
    await withPrompt(
      render(
        promptForInteractiveResourceList,
        {
          message: "Filter resources",
          resources: makeOverflowResources(),
        },
        { clearPromptOnDone: true },
      ),
      ({ getScreen }) => {
        const hintLines = overflowHintLines(getScreen());
        expect(hintLines.length).toBeGreaterThan(0);
        expect(hintLines.length).toBeLessThanOrEqual(2);
        if (hintLines.length === 1) {
          expect(hintLines[0]).toContain(" · ");
        }
      },
    );
  });

  promptIt("environment list shows esc exit and unified chrome", async () => {
    await withPrompt(
      render(
        promptForInteractiveEnvironmentList,
        {
          message: "Filter environments",
          environments: [
            makeEnvironmentRow("production"),
            makeEnvironmentRow("staging"),
          ],
        },
        { clearPromptOnDone: true },
      ),
      ({ getScreen }) => {
        const frame = getScreen();
        expect(frame).toContain("esc exit");
        expect(frame).not.toContain("esc cancel");
        expect(frame).toContain("Search:");
        expectNoSelectionLine(frame);
      },
    );
  });

  promptIt("plugin list browse shows esc cancel and unified chrome", async () => {
    await withPrompt(
      render(
        promptForInteractivePluginListBrowse,
        {
          message: "Select a plugin to install",
          scopeLabel: "harnesstap-cloud",
          localPlugins,
          listRemotePlugins: async () => samplePlugins,
        },
        { clearPromptOnDone: true },
      ),
      async ({ getScreen, nextRender }) => {
        await nextRender();
        const frame = getScreen();
        expect(frame).toContain("esc cancel");
        expect(frame).toContain("Search:");
        expectNoSelectionLine(frame);
      },
    );
  });

  promptIt("catalog browser shows esc cancel and unified chrome", async () => {
    await withPrompt(
      render(
        promptForInteractiveCatalogBrowser,
        {
          message: "Browse catalog plugins to install",
          scopeLabel: "harnesstap-cloud",
          listPlugins: async () => samplePlugins,
        },
        { clearPromptOnDone: true },
      ),
      async ({ getScreen, nextRender }) => {
        await nextRender();
        const frame = getScreen();
        expect(frame).toContain("esc cancel");
        expect(frame).toContain("Search:");
        expectNoSelectionLine(frame);
      },
    );
  });

  promptIt("searchable multi-select shows esc back", async () => {
    await withPrompt(
      render(
        promptForSearchableMultiSelect,
        {
          message: "Select alias harnesses",
          choices: [
            { name: "Claude Code", value: "claude-code" },
            { name: "Cursor", value: "cursor" },
          ],
        },
        { clearPromptOnDone: true },
      ),
      ({ getScreen }) => {
        expect(getScreen()).toContain("esc back");
      },
    );
  });

  promptIt("catalog search apply mode shows ctrl+s and esc cancel", async () => {
    await withPrompt(
      render(
        promptForInteractiveCatalogSearch,
        {
          message: "Search catalog plugins to apply",
          scopeLabel: "harnesstap-cloud",
          initialQuery: "fullstack",
          listPlugins: async () => samplePlugins,
        },
        { clearPromptOnDone: true },
      ),
      async ({ getScreen, nextRender }) => {
        await nextRender();
        const frame = getScreen();
        expect(frame).toContain("ctrl+s");
        expect(frame).toContain("esc cancel");
        expectNoSelectionLine(frame);
      },
    );
  });
});
