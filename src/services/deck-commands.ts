import { getEnvironment } from "../models/environment.js";
import {
  deleteDeck,
  listDecks,
} from "../models/deck.js";
import { exportDeckToDeckJson } from "./exporter.js";
import { resolveDeckOrThrow } from "./resolve-deck-layers.js";
import { ui } from "../ui/index.js";

export interface DeckShowRow {
  order: number;
  name: string;
  version: string;
  org_catalog: string;
  default_environment: string;
}

export interface DeckShowPayload {
  id: string;
  name: string;
  root_path: string;
  active_environment: string | null;
  layers: DeckShowRow[];
  environments_referenced: string[];
  deck_json: ReturnType<typeof exportDeckToDeckJson>;
}

function formatOrgCatalog(
  org?: string,
  catalog?: string,
): string {
  if (org && catalog) {
    return `${org}/${catalog}`;
  }
  return "—";
}

export function buildDeckShowPayload(deckSelector: string): DeckShowPayload {
  const deck = resolveDeckOrThrow(deckSelector);
  const deckJson = exportDeckToDeckJson(deck.id);
  const activeEnvironment = deck.active_environment_id
    ? getEnvironment(deck.active_environment_id)?.name ?? null
    : null;

  const layers: DeckShowRow[] = deckJson.layers.map((entry, index) => ({
    order: index + 1,
    name: entry.name,
    version: entry.version,
    org_catalog: formatOrgCatalog(entry.org, entry.catalog),
    default_environment: entry.environment ?? "—",
  }));

  const environmentNames = new Set<string>();
  for (const environment of deckJson.environments) {
    environmentNames.add(environment.name);
  }
  if (activeEnvironment) {
    environmentNames.add(activeEnvironment);
  }

  return {
    id: deck.id,
    name: deck.name,
    root_path: deck.root_path,
    active_environment: activeEnvironment,
    layers,
    environments_referenced: [...environmentNames].sort((a, b) => a.localeCompare(b)),
    deck_json: deckJson,
  };
}

export function printDeckShowHuman(payload: DeckShowPayload, showId: boolean): void {
  console.log(`${ui.theme.muted("Deck:")} ${ui.theme.accent(payload.name)}`);
  if (showId) {
    console.log(ui.theme.muted(`  ${ui.icons.bullet} id ${payload.id}`));
  }
  console.log(
    `${ui.theme.muted("Root:")} ${
      payload.root_path
        ? payload.root_path
        : ui.theme.muted("(not set)")
    }`,
  );
  console.log(
    `${ui.theme.muted("Active environment:")} ${
      payload.active_environment
        ? payload.active_environment
        : ui.theme.muted("(none)")
    }`,
  );
  console.log();

  ui.table.print({
    columns: [
      { key: "order", header: "ORDER", width: 6 },
      { key: "name", header: "NAME", width: 24 },
      { key: "version", header: "VERSION", width: 10 },
      { key: "org_catalog", header: "ORG/CATALOG", width: 20 },
      { key: "default_environment", header: "DEFAULT ENV", width: 16 },
    ],
    rows: payload.layers,
    empty: "No layers in this deck.",
  });

  if (payload.environments_referenced.length > 0) {
    console.log();
    console.log(
      ui.theme.muted(
        `Environments referenced: ${payload.environments_referenced.join(", ")}`,
      ),
    );
  }
}

export function deleteDeckCommand(
  deckSelector: string,
): { deleted: true; name: string } {
  const deck = resolveDeckOrThrow(deckSelector);
  if (!deleteDeck(deck.id)) {
    throw new Error(`Failed to delete deck ${deck.name}`);
  }
  return { deleted: true, name: deck.name };
}

export function listDeckNamesForWizard(): Array<{ name: string; id: string; root_path: string }> {
  return listDecks().map((deck) => ({
    name: deck.name,
    id: deck.id,
    root_path: deck.root_path,
  }));
}
