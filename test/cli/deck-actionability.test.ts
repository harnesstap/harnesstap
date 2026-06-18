import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import {
  addConfiguredLayerToDeck,
  createDeck,
  getDeckByName,
} from "../../src/models/deck.js";
import { createLayer, addResourceToLayer } from "../../src/models/layer-model.js";
import { createLayerFromSources } from "../../src/models/layer-model.js";
import { createResource } from "../../src/models/resource.js";
import { createInitializedTestContext, createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI deck actionability", () => {
  it("deck show lists ordered layers", async () => {
    const context = await createInitializedTestContext("cli-deck-show");

    try {
    const suffix = ulid().toLowerCase();
    const plugin = createLayer({ name: `deck-show-plugin-${suffix}` });
    addResourceToLayer(
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
    const layer = createLayerFromSources({
      name: `deck-show-layer-${suffix}`,
      sourceLayerIds: [plugin.id],
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
    const plugin = createLayer({ name: `deck-delete-plugin-${suffix}` });
    const layer = createLayerFromSources({
      name: `deck-delete-layer-${suffix}`,
      sourceLayerIds: [plugin.id],
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
      const plugin = createLayer({ name: `deck-apply-plugin-${suffix}` });
      addResourceToLayer(
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
      const layer = createLayerFromSources({
        name: `deck-apply-layer-${suffix}`,
        sourceLayerIds: [plugin.id],
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

  it("layer apply works", async () => {
    const context = await createTestContext("cli-layer-apply");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-layer-apply.git");
      await runCli(["init", "--main", "claude-code"]);

      const suffix = ulid().toLowerCase();
      const plugin = createLayer({ name: `layer-apply-plugin-${suffix}` });
      addResourceToLayer(
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
      const layer = createLayerFromSources({
        name: `layer-apply-${suffix}`,
        sourceLayerIds: [plugin.id],
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
    } finally {
      await context.cleanup();
    }
  });
});
