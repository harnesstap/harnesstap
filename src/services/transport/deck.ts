import type {
  DeckJson,
  DeckJsonEnvironment,
  DeckJsonEnvironmentSecretRef,
  DeckJsonLayer,
} from "../../types.js";
import {
  DECK_JSON_VERSION,
  DECK_SCHEMA,
} from "../../types.js";
import { parseTransportToml } from "./read.js";
import { sortStringRecord } from "./sort.js";
import { readSchemaHeader } from "./validate.js";
import { formatTransportToml } from "./write.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function environmentsToTomlRecord(
  environments: DeckJsonEnvironment[],
): Record<string, Record<string, unknown>> {
  const record: Record<string, Record<string, unknown>> = {};
  for (const environment of [...environments].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const row: Record<string, unknown> = {};
    if (Object.keys(environment.values).length > 0) {
      row.values = sortStringRecord(environment.values);
    }
    if (environment.secret_refs && Object.keys(environment.secret_refs).length > 0) {
      row.secret_refs = environment.secret_refs;
    }
    record[environment.name] = row;
  }
  return record;
}

function environmentsFromTomlRecord(
  record: unknown,
): DeckJsonEnvironment[] {
  if (!isRecord(record)) {
    return [];
  }

  return Object.entries(record)
    .map(([name, value]) => {
      if (!isRecord(value)) {
        throw new Error(`Environment ${name} must be a table`);
      }
      const valuesRaw = value.values;
      const values: Record<string, string> = {};
      if (isRecord(valuesRaw)) {
        for (const [key, entry] of Object.entries(valuesRaw)) {
          values[key] = String(entry);
        }
      }
      const secretRefsRaw = value.secret_refs;
      const secret_refs: Record<string, DeckJsonEnvironmentSecretRef> = {};
      if (isRecord(secretRefsRaw)) {
        for (const [key, entry] of Object.entries(secretRefsRaw)) {
          if (!isRecord(entry)) {
            continue;
          }
          secret_refs[key] = {
            provider: String(entry.provider ?? "env") as DeckJsonEnvironmentSecretRef["provider"],
            ref: String(entry.ref ?? ""),
          };
        }
      }
      return {
        name,
        values,
        ...(Object.keys(secret_refs).length > 0 ? { secret_refs } : {}),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseDeckLayer(value: unknown): DeckJsonLayer {
  if (!isRecord(value)) {
    throw new Error("Deck layer selector must be a table");
  }
  const layer: DeckJsonLayer = {
    name: String(value.name ?? ""),
    version: String(value.version ?? "1.0.0"),
  };
  if (typeof value.org === "string" && value.org.length > 0) {
    layer.org = value.org;
  }
  if (typeof value.catalog === "string" && value.catalog.length > 0) {
    layer.catalog = value.catalog;
  }
  if (typeof value.environment === "string" && value.environment.length > 0) {
    layer.environment = value.environment;
  }
  return layer;
}

function serializeDeckLayer(layer: DeckJsonLayer): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: layer.name,
    version: layer.version,
  };
  if (layer.org) row.org = layer.org;
  if (layer.catalog) row.catalog = layer.catalog;
  if (layer.environment) row.environment = layer.environment;
  return row;
}

export function deckJsonToTomlDocument(deck: DeckJson): Record<string, unknown> {
  const document: Record<string, unknown> = {
    schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: deck.name,
    layers: deck.layers
      .map(serializeDeckLayer)
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
  };
  if (deck.active_environment) {
    document.active_environment = deck.active_environment;
  }
  if (deck.environments.length > 0) {
    document.environments = environmentsToTomlRecord(deck.environments);
  }
  return document;
}

export function deckJsonFromTomlDocument(document: Record<string, unknown>): DeckJson {
  const layersRaw = document.layers;
  const layers = Array.isArray(layersRaw)
    ? layersRaw.map(parseDeckLayer)
    : [];

  return {
    $schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: String(document.name ?? ""),
    layers,
    environments: environmentsFromTomlRecord(document.environments),
    ...(typeof document.active_environment === "string"
      ? { active_environment: document.active_environment }
      : {}),
  };
}

export function parseDeckToml(raw: string): DeckJson {
  const document = parseTransportToml(raw, "deck");
  const { schema, version } = readSchemaHeader(document);
  if (schema !== DECK_SCHEMA) {
    throw new Error(`Unsupported deck schema: ${schema}`);
  }
  if (version !== DECK_JSON_VERSION) {
    throw new Error(`Unsupported deck version: ${version}`);
  }
  return deckJsonFromTomlDocument(document);
}

export function formatDeckToml(deck: DeckJson): string {
  return formatTransportToml(deckJsonToTomlDocument(deck));
}
