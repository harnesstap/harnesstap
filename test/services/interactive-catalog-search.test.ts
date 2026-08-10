import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt } from "../helpers/prompt-test.ts";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import { promptForInteractiveCatalogSearch } from "../../src/services/wizards/interactive-catalog-search.ts?actual";

const CTRL_S = { name: "s", ctrl: true } as const;

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
  {
    orgSlug: "harnesstap-cloud",
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
  promptIt("toggles plugins with space and applies checked plugins on ctrl+s", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog plugins to apply",
        scopeLabel: "harnesstap-cloud",
        initialQuery: "fullstack",
        listPlugins: async () => samplePlugins,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("space");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toEqual({
      selections: [
        expect.objectContaining({
          orgSlug: "harnesstap-cloud",
          catalogSlug: "default",
          slug: "fullstack",
        }),
      ],
    });
  });

  promptIt("shows plugin details on enter and returns to browse on esc", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog plugins to apply",
        scopeLabel: "harnesstap-cloud",
        initialQuery: "fullstack",
        listPlugins: async () => samplePlugins,
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

  promptIt("does not re-fetch on every render when listPlugins resolves synchronously", async () => {
    let callCount = 0;
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog plugins to apply",
        scopeLabel: "harnesstap-cloud",
        initialQuery: "fullstack",
        listPlugins: () => {
          callCount += 1;
          return samplePlugins as unknown as Promise<typeof samplePlugins>;
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

  promptIt("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveCatalogSearch,
      {
        message: "Search catalog plugins to apply",
        scopeLabel: "harnesstap-cloud",
        initialQuery: "fullstack",
        listPlugins: async () => samplePlugins,
      },
      { clearPromptOnDone: true },
    );

    events.keypress("escape");
    let rejected: unknown;
    try {
      await answer;
      throw new Error("Expected prompt to reject on escape");
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(ExitPromptError);
    expect((rejected as Error).message).toBe("Catalog search cancelled.");
  });
});
