import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { promptForInteractiveCatalogSearch } from "../../src/services/wizards/interactive-catalog-search.ts?actual";

const CTRL_S = { name: "s", ctrl: true } as const;

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
  {
    orgSlug: "harnessdeck-cloud",
    catalogSlug: "default",
    slug: "foundation",
    name: "Foundation",
    summary: "Foundation baseline",
    latestVersion: "2.0.0",
    updatedAt: "2026-01-02T00:00:00.000Z",
    tags: ["baseline"],
    visibility: "public",
  },
];

describe("interactive catalog search prompt", () => {
  it("toggles layers with space and applies checked layers on ctrl+s", async () => {
    const { answer, events, nextRender } = await render(
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
    events.keypress("space");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toEqual({
      selections: [
        expect.objectContaining({
          orgSlug: "harnessdeck-cloud",
          catalogSlug: "default",
          slug: "fullstack",
        }),
      ],
    });
  });

  it("shows layer details on enter and returns to browse on esc", async () => {
    const { answer, events, nextRender } = await render(
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
    events.keypress("enter");
    await nextRender();
    events.keypress("escape");
    await nextRender();
    events.keypress("space");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toEqual({
      selections: [
        expect.objectContaining({
          slug: "fullstack",
        }),
      ],
    });
  });

  it("does not re-fetch on every render when listLayers resolves synchronously", async () => {
    let callCount = 0;
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog layers to apply",
        scopeLabel: "harnessdeck-cloud",
        initialQuery: "fullstack",
        listLayers: () => {
          callCount += 1;
          return sampleLayers as unknown as Promise<typeof sampleLayers>;
        },
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    expect(callCount).toBeLessThanOrEqual(1);

    events.keypress("space");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toEqual({
      selections: [
        expect.objectContaining({
          slug: "fullstack",
        }),
      ],
    });
  });

  it("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog layers to apply",
        scopeLabel: "harnessdeck-cloud",
        initialQuery: "fullstack",
        listLayers: async () => sampleLayers,
      },
      { clearPromptOnDone: true },
    );

    expect(() => events.keypress("escape")).toThrow(ExitPromptError);
    void answer.catch(() => undefined);
  });
});
