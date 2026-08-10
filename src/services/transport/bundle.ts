import type {
  DeckJson,
  DeckJsonPlugin,
  PluginExport,
  MultiPluginExport,
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
  pluginExportFromTomlDocument,
  normalizePluginExportForToml,
  serializePluginEntry,
} from "./plugin.js";
import { parseTransportToml } from "./read.js";
import { readSchemaHeader } from "./validate.js";
import { formatTransportToml } from "./write.js";

export interface BundleExport {
  schema: typeof BUNDLE_SCHEMA;
  version: typeof BUNDLE_SCHEMA_VERSION;
  deck: Pick<DeckJson, "name" | "active_environment" | "plugins">;
  environments: DeckJson["environments"];
  plugins: MultiPluginExport["plugins"];
  embedded_plugins: MultiPluginExport["embedded_plugins"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDeckPlugin(value: unknown): DeckJsonPlugin {
  if (!isRecord(value)) {
    throw new Error("Bundle plugin selector must be a table");
  }
  const plugin: DeckJsonPlugin = {
    name: String(value.name ?? ""),
    version: String(value.version ?? "1.0.0"),
  };
  if (typeof value.org === "string" && value.org.length > 0) {
    plugin.org = value.org;
  }
  if (typeof value.catalog === "string" && value.catalog.length > 0) {
    plugin.catalog = value.catalog;
  }
  if (typeof value.environment === "string" && value.environment.length > 0) {
    plugin.environment = value.environment;
  }
  return plugin;
}

function serializeDeckPlugin(plugin: DeckJsonPlugin): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: plugin.name,
    version: plugin.version,
  };
  if (plugin.org) row.org = plugin.org;
  if (plugin.catalog) row.catalog = plugin.catalog;
  if (plugin.environment) row.environment = plugin.environment;
  return row;
}

function deckSectionToTomlDocument(
  deck: Pick<DeckJson, "name" | "active_environment" | "plugins">,
  environments: DeckJson["environments"],
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: deck.name,
    plugins: deck.plugins
      .map(serializeDeckPlugin)
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
  deck: Pick<DeckJson, "name" | "active_environment" | "plugins">;
  environments: DeckJson["environments"];
} {
  const pluginsRaw = document.plugins;
  const plugins = Array.isArray(pluginsRaw)
    ? pluginsRaw.map(parseDeckPlugin)
    : [];

  return {
    deck: {
      name: String(document.name ?? ""),
      plugins,
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
      plugins: deckDocument.plugins,
    },
    environments: deckDocument.environments,
    plugins: bundle.plugins
      .map(serializePluginEntry)
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
    plugins: deckRaw.plugins,
    environments: document.environments,
  });

  const pluginExport = pluginExportFromTomlDocument({
    schema: "urn:harnesstap:plugin:v1",
    version: 1,
    plugins: document.plugins,
    embedded_plugins: document.embedded_plugins,
  });

  return {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_SCHEMA_VERSION,
    deck: deckSection.deck,
    environments: deckSection.environments,
    plugins: pluginExport.plugins,
    embedded_plugins: pluginExport.embedded_plugins,
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

export function pluginExportToBundleExport(
  deck: DeckJson,
  pluginExport: PluginExport,
): BundleExport {
  const normalized = normalizePluginExportForToml(pluginExport);
  return {
    schema: BUNDLE_SCHEMA,
    version: BUNDLE_SCHEMA_VERSION,
    deck: {
      name: deck.name,
      plugins: deck.plugins,
      ...(deck.active_environment ? { active_environment: deck.active_environment } : {}),
    },
    environments: deck.environments,
    plugins: normalized.plugins,
    embedded_plugins: normalized.embedded_plugins,
  };
}
