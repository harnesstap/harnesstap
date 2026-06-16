import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import {
  addConfiguredLayerToDeck,
  createDeck,
  getDeckByName,
} from "../../src/models/deck.js";
import { createPlugin, addResourceToPlugin } from "../../src/models/plugin-component.js";
import { createConfiguredLayer } from "../../src/models/configured-layer.js";
import { createResource } from "../../src/models/resource.js";
import { createInitializedTestContext, createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI deck actionability", () => {
  it("deck show lists ordered layers", async () => {
    const context = await createInitializedTestContext("cli-deck-show");

    try {
    const suffix = ulid().toLowerCase();
    const plugin = createPlugin({ name: `deck-show-plugin-${suffix}` });
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "instruction",
        name: "readme",
        description: "",
        content: "# Deck show",
        metadata: {},
        source: "manual",
      }).id,
    );
    const layer = createConfiguredLayer({
      name: `deck-show-layer-${suffix}`,
      pluginIds: [plugin.id],
    });
    const deck = createDeck({ name: `deck-show-${suffix}`, rootPath: "/tmp/deck" });
    addConfiguredLayerToDeck(deck.id, layer.id);

    const result = await runCli(["deck", "show", deck.name]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain(deck.name);
    expect(result.stdout).toContain(layer.name);
    expect(result.stdout).toContain("ORDER");
    } finally {
      await context.cleanup();
    }
  });

  it("deck delete removes the deck record only", async () => {
    const context = await createInitializedTestContext("cli-deck-delete");

    try {
    const suffix = ulid().toLowerCase();
    const plugin = createPlugin({ name: `deck-delete-plugin-${suffix}` });
    const layer = createConfiguredLayer({
      name: `deck-delete-layer-${suffix}`,
      pluginIds: [plugin.id],
    });
    const deck = createDeck({ name: `deck-delete-${suffix}` });
    addConfiguredLayerToDeck(deck.id, layer.id);

    const result = await runCli(["deck", "delete", deck.name, "--format", "json"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(getDeckByName(deck.name)).toBeUndefined();
    expect(
      context.connection
        .getDb()
        .prepare("SELECT id FROM layers WHERE id = ?")
        .get(layer.id),
    ).toBeTruthy();
    } finally {
      await context.cleanup();
    }
  });

  it("deck apply materializes the deck layer stack", async () => {
    const context = await createTestContext("cli-deck-apply");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-deck-apply.git");
      await runCli(["init", "--main", "claude-code"]);

      const suffix = ulid().toLowerCase();
      const plugin = createPlugin({ name: `deck-apply-plugin-${suffix}` });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "context",
          description: "",
          content: "# Deck apply",
          metadata: {},
          source: "manual",
        }).id,
      );
      const layer = createConfiguredLayer({
        name: `deck-apply-layer-${suffix}`,
        pluginIds: [plugin.id],
      });
      const deck = createDeck({ name: `deck-apply-${suffix}` });
      addConfiguredLayerToDeck(deck.id, layer.id);

      const applyResult = await runCli([
        "deck",
        "apply",
        deck.name,
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      expect(applyResult.exitCode ?? 0).toBe(0);
      expect(applyResult.stdout).toContain("claude-code");
    } finally {
      await context.cleanup();
    }
  });

  it("layer apply works and project apply remains compatible", async () => {
    const context = await createTestContext("cli-layer-apply-alias");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-layer-apply.git");
      await runCli(["init", "--main", "claude-code"]);

      const suffix = ulid().toLowerCase();
      const plugin = createPlugin({ name: `layer-apply-plugin-${suffix}` });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "notes",
          description: "",
          content: "# Layer apply",
          metadata: {},
          source: "manual",
        }).id,
      );
      const layer = createConfiguredLayer({
        name: `layer-apply-${suffix}`,
        pluginIds: [plugin.id],
      });

      const layerApply = await runCli([
        "layer",
        "apply",
        layer.name,
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);
      expect(layerApply.exitCode ?? 0).toBe(0);

      const projectApply = await runCli([
        "project",
        "apply",
        layer.name,
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
      ]);
      expect(projectApply.exitCode ?? 0).toBe(0);
      expect(projectApply.stderr + projectApply.stdout).toContain("deprecated");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects project apply --deck with a hint", async () => {
    const result = await runCli(["project", "apply", "--deck", "missing"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("deck apply");
  });
});
