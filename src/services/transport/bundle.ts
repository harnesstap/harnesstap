import type {
  DeckJson,
  DeckJsonLayer,
  LayerExport,
  MultiLayerExport,
} from "../../types.js";
import {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_VERSION,
  DECK_JSON_VERSION,
  DECK_SCHEMA,
} from "../../types.js";
import {
  embeddedPluginsToTomlRecord,
} from "./embedded-plugins.js";
import {
  environmentsFromTomlRecord,
  environmentsToTomlRecord,
} from "./environment-document.js";
import {
  layerExportFromTomlDocument,
  normalizeLayerExportForToml,
  serializeLayerEntry,
} from "./layer.js";
import { parseTransportToml } from "./read.js";
import { readSchemaHeader } from "./validate.js";
import { formatTransportToml } from "./write.js";

export interface BundleExport {
  schema: typeof BUNDLE_SCHEMA;
  version: typeof BUNDLE_SCHEMA_VERSION;
  deck: Pick<DeckJson, "name" | "active_environment" | "layers">;
  environments: DeckJson["environments"];
  layers: MultiLayerExport["layers"];
  embedded_plugins: MultiLayerExport["embedded_plugins"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDeckLayer(value: unknown): DeckJsonLayer {
  if (!isRecord(value)) {
    throw new Error("Bundle layer selector must be a table");
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

function deckSectionToTomlDocument(
  deck: Pick<DeckJson, "name" | "active_environment" | "layers">,
  environments: DeckJson["environments"],
): Record<string, unknown> {
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
  if (environments.length > 0) {
    document.environments = environmentsToTomlRecord(environments);
  }
  return document;
}

function deckSectionFromTomlDocument(document: Record<string, unknown>): {
  deck: Pick<DeckJson, "name" | "active_environment" | "layers">;
  environments: DeckJson["environments"];
} {
  const layersRaw = document.layers;
  const layers = Array.isArray(layersRaw)
    ? layersRaw.map(parseDeckLayer)
    : [];

  return {
    deck: {
      name: String(document.name ?? ""),
      layers,
      ...(typeof document.active_environment === "string"
        ? { active_environment: document.active_environment }
        : {}),
    },
    environments: environmentsFromTomlRecord(document.environments),
  };
}

export function bundleExportToTomlDocument(bundle: BundleExport): Record<string, unknown> {
  const deckDocument = deckSectionToTomlDocument(bundle.deck, bundle.environments);

  const document: Record<string, unknown> = {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_SCHEMA_VERSION,
    deck: {
      name: bundle.deck.name,
      ...(bundle.deck.active_environment
        ? { active_environment: bundle.deck.active_environment }
        : {}),
      layers: deckDocument.layers,
    },
    environments: deckDocument.environments,
    layers: bundle.layers
      .map(serializeLayerEntry)
      .sort((left, right) =>
        String(left.name).localeCompare(String(right.name)),
      ),
  };

  if (bundle.embedded_plugins.length > 0) {
    document.embedded_plugins = embeddedPluginsToTomlRecord(bundle.embedded_plugins);
  }

  return document;
}

export function bundleExportFromTomlDocument(
  document: Record<string, unknown>,
): BundleExport {
  const deckRaw = document.deck;
  if (!isRecord(deckRaw)) {
    throw new Error("Bundle export must include a [deck] table");
  }

  const deckSection = deckSectionFromTomlDocument({
    schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: deckRaw.name,
    active_environment: deckRaw.active_environment,
    layers: deckRaw.layers,
    environments: document.environments,
  });

  const layerExport = layerExportFromTomlDocument({
    schema: "urn:harnesstap:layer:v1",
    version: 1,
    layers: document.layers,
    embedded_plugins: document.embedded_plugins,
  });

  return {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_SCHEMA_VERSION,
    deck: deckSection.deck,
    environments: deckSection.environments,
    layers: layerExport.layers,
    embedded_plugins: layerExport.embedded_plugins,
  };
}

export function parseBundleToml(raw: string): BundleExport {
  const document = parseTransportToml(raw, "bundle");
  const { schema, version } = readSchemaHeader(document);
  if (schema !== BUNDLE_SCHEMA) {
    throw new Error(`Unsupported bundle schema: ${schema}`);
  }
  if (version !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported bundle version: ${version}`);
  }
  return bundleExportFromTomlDocument(document);
}

export function formatBundleToml(bundle: BundleExport): string {
  return formatTransportToml(bundleExportToTomlDocument(bundle));
}

export function layerExportToBundleExport(
  deck: DeckJson,
  layerExport: LayerExport,
): BundleExport {
  const normalized = normalizeLayerExportForToml(layerExport);
  return {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_SCHEMA_VERSION,
    deck: {
      name: deck.name,
      layers: deck.layers,
      ...(deck.active_environment ? { active_environment: deck.active_environment } : {}),
    },
    environments: deck.environments,
    layers: normalized.layers,
    embedded_plugins: normalized.embedded_plugins,
  };
}
