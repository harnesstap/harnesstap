import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { promptForInteractiveLayerListBrowse } from "../../src/services/wizards/interactive-layer-list-browse.ts?actual";
import type { Layer } from "../../src/types.js";

const localLayers: Layer[] = [
  {
    id: "layer-1",
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

const remoteLayers: CatalogLayer[] = [
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

describe("interactive layer list browse prompt", () => {
  it("shows local and remote sections in one frame", async () => {
    const { getScreen, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer to install",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    const frame = getScreen();
    expect(frame).toContain("team-stack");
    expect(frame).toContain("Local layers");
  });

  it("installs a remote layer after navigating down", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer to install",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("down");
    events.keypress("enter");

    await expect(answer).resolves.toEqual({
      orgSlug: "harnessdeck-cloud",
      catalogSlug: "default",
      slug: "fullstack",
      version: "1.0.0",
      selector: expect.stringContaining("fullstack"),
    });
  });

  it("shows local layer details on enter", async () => {
    const { getScreen, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer to install",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("enter");
    expect(getScreen()).toContain("Installed locally");
  });

  it("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer to install",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
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
    expect((rejected as Error).message).toBe("Layer list cancelled.");
  });
});
