import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import { getDb } from "../../src/db/connection.js";
import { initializeSchema } from "../../src/db/schema.js";
import { addConfiguredLayerToDeck, createDeck } from "../../src/models/deck.js";
import { createLayer } from "../../src/models/layer-model.js";
import {
  exportDeckRepo,
  importDeckRepo,
} from "../../src/services/deck-transport.js";
import { DECK_SCHEMA } from "../../src/types.js";

describe("deck transport", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exports and imports a deck repo with layer bundles", () => {
    const db = getDb();
    initializeSchema(db);

    const suffix = ulid().toLowerCase();
    const layer = createLayer({
      name: `transport-layer-${suffix}`,
      version: "1.0.0",
      description: "deck transport test",
    });
    const deck = createDeck({ name: `transport-deck-${suffix}` });
    addConfiguredLayerToDeck(deck.id, layer.id);

    const outputDir = mkdtempSync(join(tmpdir(), "hd-deck-export-"));
    tempDirs.push(outputDir);

    const exported = exportDeckRepo(deck.id, outputDir, {
      withLayerExports: true,
    });
    expect(existsSync(exported.deckJsonPath)).toBe(true);
    expect(exported.layerExportPaths).toHaveLength(1);

    const deckJson = JSON.parse(readFileSync(exported.deckJsonPath, "utf-8"));
    expect(deckJson.$schema).toBe(DECK_SCHEMA);
    expect(deckJson.layers[0]).toMatchObject({
      name: layer.name,
      version: "1.0.0",
    });
    expect(deckJson.layers[0]).not.toHaveProperty("plugins");

    const imported = importDeckRepo(outputDir, {
      deckNameOverride: `imported-deck-${suffix}`,
    });
    expect(imported.deck.name).toBe(`imported-deck-${suffix}`);
    expect(imported.configuredLayers.map((entry) => entry.name)).toContain(layer.name);
  });
});
