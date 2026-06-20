import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { promptForInteractiveCatalogBrowser } from "../../src/services/wizards/interactive-catalog-browser.ts?actual";

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

describe("interactive catalog browser prompt", () => {
  it("installs the selected layer on enter", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog layers to install",
        scopeLabel: "harnessdeck-cloud",
        listLayers: async () => sampleLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("enter");

    await expect(answer).resolves.toEqual({
      orgSlug: "harnessdeck-cloud",
      catalogSlug: "default",
      slug: "fullstack",
      version: "1.0.0",
      selector: expect.stringContaining("fullstack"),
    });
  });

  it("does not re-fetch on every render when listLayers resolves synchronously", async () => {
    let callCount = 0;
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog layers to install",
        scopeLabel: "harnessdeck-cloud",
        listLayers: () => {
          callCount += 1;
          return sampleLayers as unknown as Promise<typeof sampleLayers>;
        },
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    expect(callCount).toBeLessThanOrEqual(1);

    events.keypress("enter");

    await expect(answer).resolves.toEqual(
      expect.objectContaining({
        slug: "fullstack",
      }),
    );
  });

  it("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog layers to install",
        scopeLabel: "harnessdeck-cloud",
        listLayers: async () => sampleLayers,
      },
      { clearPromptOnDone: true },
    );

    expect(() => events.keypress("escape")).toThrow(ExitPromptError);
    void answer.catch(() => undefined);
  });
});
