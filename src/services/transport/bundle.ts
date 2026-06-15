import type { DeckJson, LayerExport, MultiLayerExport } from "../../types.js";
import {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_VERSION,
} from "../../types.js";
import { deckJsonFromTomlDocument, deckJsonToTomlDocument } from "./deck.js";
import {
  embeddedPluginsToTomlRecord,
} from "./embedded-plugins.js";
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

export function bundleExportToTomlDocument(bundle: BundleExport): Record<string, unknown> {
  const deckDocument = deckJsonToTomlDocument({
    $schema: "urn:harnessdeck:deck:v1",
    version: 1,
    name: bundle.deck.name,
    layers: bundle.deck.layers,
    environments: bundle.environments,
    ...(bundle.deck.active_environment
      ? { active_environment: bundle.deck.active_environment }
      : {}),
  });

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

  const deckJson = deckJsonFromTomlDocument({
    schema: "urn:harnessdeck:deck:v1",
    version: 1,
    name: deckRaw.name,
    active_environment: deckRaw.active_environment,
    layers: deckRaw.layers,
    environments: document.environments,
  });

  const layerExport = layerExportFromTomlDocument({
    schema: "urn:harnessdeck:layer:v1",
    version: 1,
    layers: document.layers,
    embedded_plugins: document.embedded_plugins,
  });

  return {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_SCHEMA_VERSION,
    deck: {
      name: deckJson.name,
      layers: deckJson.layers,
      ...(deckJson.active_environment
        ? { active_environment: deckJson.active_environment }
        : {}),
    },
    environments: deckJson.environments,
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
