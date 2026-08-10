import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import { promptForInteractivePluginListBrowse } from "../../src/services/wizards/interactive-plugin-list-browse.ts?actual";
import type { Plugin } from "../../src/types.js";

const CTRL_E = { name: "e", ctrl: true } as const;
const CTRL_X = { name: "x", ctrl: true } as const;

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

const remotePlugins: CatalogPlugin[] = [
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

const manageableRemotePlugins: CatalogPlugin[] = [
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
    pluginId: "plugin-remote-1",
    orgId: "org-acme",
    manageable: true,
  },
];

describe("interactive plugin list browse prompt", () => {
  promptIt("shows local and remote sections in one frame", async () => {
    await withPrompt(
      render(
        promptForInteractivePluginListBrowse,
        {
          message: "Select a plugin",
          scopeLabel: "harnesstap-cloud",
          localPlugins,
          listRemotePlugins: async () => remotePlugins,
        },
        { clearPromptOnDone: true },
      ),
      async ({ getScreen, nextRender }) => {
        await nextRender();
        const frame = getScreen();
        expect(frame).toContain("team-stack");
        expect(frame).toContain("Local plugins");
      },
    );
  });

  promptIt("shows remote catalog details on enter and installs from show view", async () => {
    const { answer, events, getScreen, nextRender } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "harnesstap-cloud",
        localPlugins,
        listRemotePlugins: async () => remotePlugins,
        fetchRemotePluginShow: async () => [
          "PLUGIN  harnesstap-cloud/default/fullstack@1.0.0",
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
    expect(getScreen()).not.toContain("Catalog plugin not found");
    events.keypress("i");

    await expect(answer).resolves.toEqual({
      action: "install",
      selection: {
        orgSlug: "harnesstap-cloud",
        catalogSlug: "default",
        slug: "fullstack",
        version: "1.0.0",
        selector: expect.stringContaining("fullstack"),
      },
    });
  });

  promptIt("returns apply action from remote show view", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "harnesstap-cloud",
        localPlugins,
        listRemotePlugins: async () => remotePlugins,
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

  promptIt("shows local plugin details on enter", async () => {
    const context = await createInitializedTestContext("interactive-plugin-list-browse-local-show");
    try {
      await withPrompt(
        render(
          promptForInteractivePluginListBrowse,
          {
            message: "Select a plugin",
            scopeLabel: "harnesstap-cloud",
            localPlugins,
            listRemotePlugins: async () => remotePlugins,
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

  promptIt("edits a local plugin with ctrl+e from browse", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "harnesstap-cloud",
        localPlugins,
        listRemotePlugins: async () => remotePlugins,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_E);

    await expect(answer).resolves.toEqual({ action: "edit", name: "team-stack" });
  });

  promptIt("deletes a local plugin with ctrl+x after confirm", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "harnesstap-cloud",
        localPlugins,
        listRemotePlugins: async () => remotePlugins,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_X);
    events.keypress("y");

    await expect(answer).resolves.toEqual({ action: "delete", name: "team-stack" });
  });

  promptIt("edits a manageable remote catalog plugin with ctrl+e from browse", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "acme",
        localPlugins: [],
        listRemotePlugins: async () => manageableRemotePlugins,
      },
      { clearPromptOnDone: true },
    );

    await nextRender();
    events.keypress(CTRL_E);

    await expect(answer).resolves.toEqual({
      action: "edit-remote",
      selection: expect.objectContaining({ slug: "team-stack" }),
      catalogPlugin: manageableRemotePlugins[0],
    });
  });

  promptIt("deletes a manageable remote catalog plugin with ctrl+x after confirm", async () => {
    const { answer, events, nextRender } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "acme",
        localPlugins: [],
        listRemotePlugins: async () => manageableRemotePlugins,
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
      catalogPlugin: manageableRemotePlugins[0],
    });
  });

  promptIt("cancels with escape", async () => {
    const { answer, events } = await render(
      promptForInteractivePluginListBrowse,
      {
        message: "Select a plugin",
        scopeLabel: "harnesstap-cloud",
        localPlugins,
        listRemotePlugins: async () => remotePlugins,
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
    expect((rejected as Error).message).toBe("Plugin list cancelled.");
  });
});
