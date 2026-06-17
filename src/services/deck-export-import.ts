import {
  getLayerByPublishedIdentity,
  setLayerDefaultEnvironment,
} from "../models/layer-model.js";
import {
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import {
  addConfiguredLayerToDeck,
  createDeck,
  getDeck,
  listDeckLayers,
  setDeckActiveEnvironment,
} from "../models/deck.js";
import {
  addResourceToEnvironment,
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironment,
  getEnvironmentByName,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
} from "../models/environment.js";
import type {
  ConfiguredLayer,
  Deck,
  DeckJson,
  DeckJsonEnvironment,
  DeckJsonEnvironmentSecretRef,
  DeckJsonExportOptions,
  DeckJsonLayer,
  EnvVarMetadata,
  Environment,
  Layer,
  Plugin,
} from "../types.js";
import { getLayerById } from "../models/layer-model.js";
import {
  DECK_JSON_VERSION,
  DECK_SCHEMA,
} from "../types.js";
import {
  assertTransportExtension,
  parseDeckToml,
  readTransportFile,
  writeTransportToml,
  deckJsonToTomlDocument,
} from "./transport/index.js";

export interface ImportDeckJsonResult {
  deck: Deck;
  plugins: Plugin[];
  configuredLayers: ConfiguredLayer[];
  environments: Environment[];
}

export interface ImportDeckJsonOptions {
  rootPath?: string;
  resourceSource?: string;
  deckNameOverride?: string;
}

function isSelectorOnlyExport(options?: DeckJsonExportOptions): boolean {
  return options?.selectorOnly !== false;
}

function environmentToDeckJson(environmentId: string): DeckJsonEnvironment {
  const environment = getEnvironment(environmentId);
  if (!environment) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const values: Record<string, string> = {};
  for (const resource of getEnvironmentResources(environmentId)) {
    if (resource.type === "env_var") {
      const meta = resource.metadata as EnvVarMetadata;
      values[meta.key] = meta.value;
    }
  }

  const secretRefs = getEnvironmentSecretRefs(environmentId);
  const secret_refs =
    secretRefs.length > 0
      ? Object.fromEntries(
          secretRefs.map((ref) => [
            ref.key,
            {
              provider: ref.provider as DeckJsonEnvironmentSecretRef["provider"],
              ref: ref.ref,
            },
          ]),
        )
      : undefined;

  return {
    name: environment.name,
    values,
    ...(secret_refs ? { secret_refs } : {}),
  };
}

function layerToDeckJsonEntry(
  layer: Layer,
  layerEnvironment: string | undefined,
  selectorOnly: boolean,
): DeckJsonLayer {
  const entry: DeckJsonLayer = {
    name: layer.name,
    version: layer.version,
    ...(layer.org_slug ? { org: layer.org_slug } : {}),
    ...(layer.catalog_slug ? { catalog: layer.catalog_slug } : {}),
    ...(layerEnvironment ? { environment: layerEnvironment } : {}),
  };

  if (!selectorOnly) {
    entry.plugins = [{ name: layer.name, version: layer.version }];
  }

  return entry;
}

/**
 * Serialize a deck row and its layers to deck.json.
 */
export function exportDeckToDeckJson(
  deckId: string,
  options?: DeckJsonExportOptions,
): DeckJson {
  const deck = getDeck(deckId);
  if (!deck) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  const selectorOnly = isSelectorOnlyExport(options);
  const environmentsByName = new Map<string, DeckJsonEnvironment>();
  const deckLayers: DeckJsonLayer[] = [];

  const rememberEnvironment = (environmentId: string | undefined): string | undefined => {
    if (!environmentId) return undefined;
    const environment = getEnvironment(environmentId);
    if (!environment) return undefined;
    if (!environmentsByName.has(environment.name)) {
      environmentsByName.set(environment.name, environmentToDeckJson(environmentId));
    }
    return environment.name;
  };

  if (deck.active_environment_id) {
    rememberEnvironment(deck.active_environment_id);
  }

  for (const link of listDeckLayers(deckId)) {
    const layer = getLayerById(link.layer_id);
    if (!layer) continue;

    const layerEnvironment = rememberEnvironment(layer.default_environment_id);

    deckLayers.push(layerToDeckJsonEntry(layer, layerEnvironment, selectorOnly));
  }

  const activeEnvironment = deck.active_environment_id
    ? getEnvironment(deck.active_environment_id)?.name
    : undefined;

  return {
    $schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: deck.name,
    layers: deckLayers,
    environments: [...environmentsByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    ...(activeEnvironment ? { active_environment: activeEnvironment } : {}),
  };
}

export function readDeckToml(filePath: string): DeckJson {
  return parseDeckToml(readTransportFile(filePath));
}

function formatDeckJsonLayerSelector(layer: DeckJsonLayer): string {
  const parts: string[] = [];
  if (layer.org) {
    parts.push(layer.org);
    if (layer.catalog) {
      parts.push(layer.catalog);
    }
  }
  parts.push(layer.name);
  const base = parts.join("/");
  return layer.version ? `${base}@${layer.version}` : base;
}

function resolveDeckJsonLayerSelector(layer: DeckJsonLayer): Layer {
  const resolved = getLayerByPublishedIdentity({
    name: layer.name,
    version: layer.version,
    org: layer.org,
    catalog: layer.catalog,
  });
  if (!resolved) {
    throw new Error(
      `Layer not found for deck import: ${formatDeckJsonLayerSelector(layer)}`,
    );
  }
  return resolved;
}

export function importDeckEnvironment(
  environment: DeckJsonEnvironment,
  opts?: ImportDeckJsonOptions,
): Environment {
  const existing = getEnvironmentByName(environment.name);
  if (existing) {
    return existing;
  }

  const created = createEnvironment({
    name: environment.name,
    description: `imported environment ${environment.name}`,
  });

  for (const [key, value] of Object.entries(environment.values)) {
    const upserted = upsertResource(
      normalizeResourceInput({
        type: "env_var",
        name: key,
        namespace: created.name,
        description: "",
        content: "",
        metadata: { key, value },
        source: opts?.resourceSource ?? "import:deck.toml",
        origin_ref: `environment:${created.id}`,
      }),
      { policy: "overwrite" },
    );
    if (upserted.action === "skipped") {
      throw new Error(`Failed to import env var resource: ${key}`);
    }
    addResourceToEnvironment(created.id, upserted.resource);
  }

  for (const [key, secretRef] of Object.entries(environment.secret_refs ?? {})) {
    addSecretRefToEnvironment(
      created.id,
      key,
      secretRef.provider,
      secretRef.ref,
    );
  }

  return created;
}

/**
 * Import deck.toml into the database (layers must already exist locally).
 */
export function importDeckToml(
  filePath: string,
  opts?: ImportDeckJsonOptions,
): ImportDeckJsonResult {
  const deckJson = readDeckToml(filePath);
  const environments: Environment[] = [];
  const environmentIdsByName = new Map<string, string>();

  for (const environment of deckJson.environments) {
    const imported = importDeckEnvironment(environment, opts);
    environments.push(imported);
    environmentIdsByName.set(imported.name, imported.id);
  }

  const configuredLayers: ConfiguredLayer[] = [];
  const plugins: Plugin[] = [];

  for (const layer of deckJson.layers) {
    const environmentId = layer.environment
      ? environmentIdsByName.get(layer.environment)
      : undefined;

    const resolvedLayer = resolveDeckJsonLayerSelector(layer);
    if (environmentId) {
      setLayerDefaultEnvironment(resolvedLayer.id, environmentId);
    }

    const refreshed = getLayerById(resolvedLayer.id);
    if (!refreshed) {
      throw new Error(`Layer ${resolvedLayer.id} not found after deck.toml import`);
    }
    configuredLayers.push(refreshed);
    if (!plugins.some((entry) => entry.id === refreshed.id)) {
      plugins.push(refreshed);
    }
  }

  const deck = createDeck({
    name: opts?.deckNameOverride ?? deckJson.name,
    rootPath: opts?.rootPath ?? "",
  });

  for (const configuredLayer of configuredLayers) {
    addConfiguredLayerToDeck(deck.id, configuredLayer.id);
  }

  if (deckJson.active_environment) {
    const activeId = environmentIdsByName.get(deckJson.active_environment);
    if (activeId) {
      setDeckActiveEnvironment(deck.id, activeId);
    }
  }

  const finalized = getDeck(deck.id);
  if (!finalized) {
    throw new Error(`Deck ${deck.id} not found after deck.toml import`);
  }

  return {
    deck: finalized,
    plugins,
    configuredLayers,
    environments,
  };
}

export function writeDeckToml(filePath: string, deckJson: DeckJson): void {
  assertTransportExtension(filePath);
  writeTransportToml(filePath, deckJsonToTomlDocument(deckJson));
}
