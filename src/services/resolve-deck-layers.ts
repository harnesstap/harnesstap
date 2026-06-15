import {
  getDeck,
  getDeckByName,
  listDeckLayers,
} from "../models/deck.js";
import { getLayerById } from "../models/layer-model.js";
import type { Deck, Layer } from "../types.js";

export class DeckResolveError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[] = []) {
    super(message);
    this.name = "DeckResolveError";
    this.hints = hints;
  }
}

export function resolveDeck(deckSelector: string): Deck | undefined {
  return getDeck(deckSelector) ?? getDeckByName(deckSelector);
}

export function resolveDeckOrThrow(deckSelector: string): Deck {
  const deck = resolveDeck(deckSelector);
  if (!deck) {
    throw new DeckResolveError(`Deck not found: ${deckSelector}`, [
      "hd deck list",
      "hd deck import <path>",
    ]);
  }
  return deck;
}

export function layerToApplySelector(layer: Layer): string {
  if (layer.org_slug && layer.catalog_slug) {
    return `${layer.org_slug}/${layer.catalog_slug}/${layer.name}@${layer.version}`;
  }
  return `${layer.name}@${layer.version}`;
}

export function resolveDeckLayerSelectors(deckSelector: string): string[] {
  const deck = resolveDeckOrThrow(deckSelector);
  const links = listDeckLayers(deck.id);
  if (links.length === 0) {
    throw new DeckResolveError(
      `Deck has no layers: ${deck.name}`,
      ["hd deck show " + deck.name, "hd deck import <path>"],
    );
  }

  const selectors: string[] = [];
  for (const link of links) {
    const layer = getLayerById(link.layer_id);
    if (!layer) {
      throw new DeckResolveError(
        `Layer not found for deck ${deck.name}: ${link.layer_id}`,
        ["hd deck show " + deck.name, "hd layer list"],
      );
    }
    selectors.push(layerToApplySelector(layer));
  }
  return selectors;
}
