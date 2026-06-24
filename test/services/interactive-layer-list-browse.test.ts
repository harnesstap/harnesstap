import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { promptForInteractiveLayerListBrowse } from "../../src/services/wizards/interactive-layer-list-browse.ts?actual";
import type { Layer } from "../../src/types.js";

const CTRL_E = { name: "e", ctrl: true } as const;
const CTRL_X = { name: "x", ctrl: true } as const;

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

const manageableRemoteLayers: CatalogLayer[] = [
  {
    orgSlug: "acme",
    catalogSlug: "default",
    slug: "team-stack",
    name: "Team Stack",
    summary: "Team baseline",
    latestVersion: "1.0.0",
    updatedAt: "2026-01-03T00:00:00.000Z",
    tags: [],
    visibility: "organization",
    layerId: "layer-remote-1",
    orgId: "org-acme",
    manageable: true,
  },
];

describe("interactive layer list browse prompt", () => {
  promptIt("shows local and remote sections in one frame", async () => {
    await withPrompt(
      render(
        promptForInteractiveLayerListBrowse,
        {
          message: "Select a layer",
          scopeLabel: "harnessdeck-cloud",
          localLayers,
          listRemoteLayers: async () => remoteLayers,
        },
        { clearPromptOnDone: true },
      ),
      async ({ getScreen, nextRender }) => {
        await nextRender();
        const frame = getScreen();
        expect(frame).toContain("team-stack");
        expect(frame).toContain("Local layers");
      },
    );
  });

  promptIt("shows remote catalog details on enter and installs from show view", async () => {
    const { answer, events, getScreen, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
        fetchRemoteLayerShow: async () => [
          "LAYER  harnessdeck-cloud/default/fullstack@1.0.0",
          "  Description           Fetched fullstack details",
          "RESOURCES",
          "│ TYPE           │ NAME                          │",
        ].join("\n"),
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("down");
    events.keypress("enter");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await nextRender();
      if (getScreen().includes("Fetched fullstack details")) {
        break;
      }
    }
    expect(getScreen()).toContain("Fetched fullstack details");
    expect(getScreen()).toContain("RESOURCES");
    expect(getScreen()).not.toContain("Catalog layer not found");
    events.keypress("i");

    await expect(answer).resolves.toEqual({
      action: "install",
      selection: {
        orgSlug: "harnessdeck-cloud",
        catalogSlug: "default",
        slug: "fullstack",
        version: "1.0.0",
        selector: expect.stringContaining("fullstack"),
      },
    });
  });

  promptIt("returns apply action from remote show view", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress("down");
    events.keypress("enter");
    await nextRender();
    events.keypress("a");

    await expect(answer).resolves.toEqual({
      action: "apply",
      selection: expect.objectContaining({
        slug: "fullstack",
      }),
    });
  });

  promptIt("shows local layer details on enter", async () => {
    const context = await createInitializedTestContext("interactive-layer-list-browse-local-show");
    try {
      await withPrompt(
        render(
          promptForInteractiveLayerListBrowse,
          {
            message: "Select a layer",
            scopeLabel: "harnessdeck-cloud",
            localLayers,
            listRemoteLayers: async () => remoteLayers,
          },
          { clearPromptOnDone: true },
        ),
        async ({ getScreen, events, nextRender }) => {
          await nextRender();
          events.keypress("enter");
          await nextRender();
          expect(getScreen()).toContain("Installed locally");
        },
      );
    } finally {
      await context.cleanup();
    }
  });

  promptIt("edits a local layer with ctrl+e from browse", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_E);

    await expect(answer).resolves.toEqual({ action: "edit", name: "team-stack" });
  });

  promptIt("deletes a local layer with ctrl+x after confirm", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
        scopeLabel: "harnessdeck-cloud",
        localLayers,
        listRemoteLayers: async () => remoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_X);
    events.keypress("y");

    await expect(answer).resolves.toEqual({ action: "delete", name: "team-stack" });
  });

  promptIt("edits a manageable remote catalog layer with ctrl+e from browse", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
        scopeLabel: "acme",
        localLayers: [],
        listRemoteLayers: async () => manageableRemoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_E);

    await expect(answer).resolves.toEqual({
      action: "edit-remote",
      selection: expect.objectContaining({ slug: "team-stack" }),
      catalogLayer: manageableRemoteLayers[0],
    });
  });

  promptIt("deletes a manageable remote catalog layer with ctrl+x after confirm", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
        scopeLabel: "acme",
        localLayers: [],
        listRemoteLayers: async () => manageableRemoteLayers,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_X);
    await nextRender();
    events.keypress("y");

    await expect(answer).resolves.toEqual({
      action: "delete-remote",
      selection: expect.objectContaining({ slug: "team-stack" }),
      catalogLayer: manageableRemoteLayers[0],
    });
  });

  promptIt("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveLayerListBrowse,
      {
        message: "Select a layer",
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
