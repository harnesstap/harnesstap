import { getDb } from "../db/connection.js";
import { resolve } from "node:path";
import { ulid } from "ulid";
import type { Deck, DeckConfiguredLayer } from "../types.js";

interface DeckRow {
  id: string;
  name: string;
  root_path: string;
  active_environment_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    root_path: row.root_path,
    ...(row.active_environment_id
      ? { active_environment_id: row.active_environment_id }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createDeck(input: {
  name: string;
  rootPath?: string;
}): Deck {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO decks (id, name, root_path, active_environment_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(id, input.name, input.rootPath ?? "", now, now);

  return {
    id,
    name: input.name,
    root_path: input.rootPath ?? "",
    created_at: now,
    updated_at: now,
  };
}

export function getDeck(id: string): Deck | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM decks WHERE id = ?").get(id) as
    | DeckRow
    | undefined;
  return row ? rowToDeck(row) : undefined;
}

export function getDeckByName(name: string): Deck | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM decks WHERE name = ?").get(name) as
    | DeckRow
    | undefined;
  return row ? rowToDeck(row) : undefined;
}

export function listDecks(): Deck[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM decks ORDER BY name")
    .all() as DeckRow[];
  return rows.map(rowToDeck);
}

export function getDeckByRootPath(rootPath: string): Deck | undefined {
  const resolvedRootPath = resolve(rootPath);
  return listDecks().find((deck) => resolve(deck.root_path) === resolvedRootPath);
}

export function deleteDeck(deckId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM decks WHERE id = ?").run(deckId);
  return result.changes > 0;
}

export function setDeckActiveEnvironment(
  deckId: string,
  environmentId: string | null,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE decks SET active_environment_id = ?, updated_at = ? WHERE id = ?`,
  ).run(environmentId, now, deckId);
}

export function addLayerToDeck(deckId: string, layerId: string): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM deck_layers WHERE deck_id = ?',
    )
    .get(deckId) as { max_order: number };

  db.prepare(
    `INSERT OR IGNORE INTO deck_layers (deck_id, layer_id, "order")
     VALUES (?, ?, ?)`,
  ).run(deckId, layerId, maxOrder.max_order + 1);
}

/** @deprecated Use addLayerToDeck */
export const addConfiguredLayerToDeck = addLayerToDeck;

export function removeLayerFromDeck(deckId: string, layerId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM deck_layers WHERE deck_id = ? AND layer_id = ?")
    .run(deckId, layerId);
  return result.changes > 0;
}

/** @deprecated Use removeLayerFromDeck */
export const removeConfiguredLayerFromDeck = removeLayerFromDeck;

export function listDeckLayers(
  deckId: string,
): Array<{ deck_id: string; layer_id: string; order: number }> {
  const db = getDb();
  return db
    .prepare(
      `SELECT deck_id, layer_id, "order" as "order"
       FROM deck_layers
       WHERE deck_id = ?
       ORDER BY "order"`,
    )
    .all(deckId) as Array<{ deck_id: string; layer_id: string; order: number }>;
}

/** @deprecated Use listDeckLayers */
export function listDeckConfiguredLayers(deckId: string): DeckConfiguredLayer[] {
  return listDeckLayers(deckId).map((row) => ({
    deck_id: row.deck_id,
    configured_layer_id: row.layer_id,
    order: row.order,
  }));
}
