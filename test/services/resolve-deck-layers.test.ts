import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import { getDb } from "../../src/db/connection.js";
import { initializeSchema } from "../../src/db/schema.js";
import {
  addConfiguredLayerToDeck,
  createDeck,
} from "../../src/models/deck.js";
import { createLayer } from "../../src/models/layer-model.js";
import {
  DeckResolveError,
  layerToApplySelector,
  resolveDeckLayerSelectors,
} from "../../src/services/resolve-deck-layers.js";

describe("resolveDeckLayerSelectors", () => {
  it("returns ordered layer selectors for a deck", () => {
    const db = getDb();
    initializeSchema(db);

    const suffix = ulid().toLowerCase();
    const first = createLayer({
      name: `deck-layer-a-${suffix}`,
      version: "1.0.0",
      description: "first",
    });
    const second = createLayer({
      name: `deck-layer-b-${suffix}`,
      version: "2.0.0",
      description: "second",
      org_slug: "acme",
      catalog_slug: "platform",
    });
    const deck = createDeck({ name: `stack-deck-${suffix}` });
    addConfiguredLayerToDeck(deck.id, first.id);
    addConfiguredLayerToDeck(deck.id, second.id);

    expect(resolveDeckLayerSelectors(deck.name)).toEqual([
      layerToApplySelector(first),
      layerToApplySelector(second),
    ]);
  });

  it("throws when the deck has no layers", () => {
    const db = getDb();
    initializeSchema(db);

    const deck = createDeck({ name: `empty-deck-${ulid().toLowerCase()}` });
    expect(() => resolveDeckLayerSelectors(deck.name)).toThrow(DeckResolveError);
  });
});
