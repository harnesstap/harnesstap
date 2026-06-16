import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
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
import { createInitializedTestContext } from "../helpers/db.ts";

describe("resolveDeckLayerSelectors", () => {
  it("returns ordered layer selectors for a deck", async () => {
    const context = await createInitializedTestContext("resolve-deck-layers");

    try {
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
    } finally {
      await context.cleanup();
    }
  });

  it("throws when the deck has no layers", async () => {
    const context = await createInitializedTestContext("resolve-deck-empty");

    try {
    const deck = createDeck({ name: `empty-deck-${ulid().toLowerCase()}` });
    expect(() => resolveDeckLayerSelectors(deck.name)).toThrow(DeckResolveError);
    } finally {
      await context.cleanup();
    }
  });
});
