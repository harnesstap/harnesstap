import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt } from "../helpers/prompt-test.ts";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import { promptForInteractiveCatalogBrowser } from "../../src/services/wizards/interactive-catalog-browser.ts?actual";

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

describe("interactive catalog browser prompt", () => {
  promptIt("installs the selected plugin on enter", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog plugins to install",
        scopeLabel: "harnesstap-cloud",
        listPlugins: async () => samplePlugins,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("enter");

    await expect(answer).resolves.toEqual({
      orgSlug: "harnesstap-cloud",
      catalogSlug: "default",
      slug: "fullstack",
      version: "1.0.0",
      selector: expect.stringContaining("fullstack"),
    });
  });

  promptIt("does not re-fetch on every render when listPlugins resolves synchronously", async () => {
    let callCount = 0;
    const { answer, events, nextRender } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog plugins to install",
        scopeLabel: "harnesstap-cloud",
        listPlugins: () => {
          callCount += 1;
          return samplePlugins as unknown as Promise<typeof samplePlugins>;
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

  promptIt("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveCatalogBrowser,
      {
        message: "Browse catalog plugins to install",
        scopeLabel: "harnesstap-cloud",
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
    expect((rejected as Error).message).toBe("Catalog browse cancelled.");
  });
});
