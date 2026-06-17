import { resolve } from "node:path";
import {
  createLayer,
  addResourceToLayer,
  syncClaudeLayerPluginsAfterAdd,
  addDependencyToLayer,
  getLayer,
  getLayerById,
  setLayerDefaultEnvironment,
} from "../models/layer-model.js";
import { attachPluginPinToLayer } from "./layer-composition.js";
import { isCompositionResourceType } from "./layer-composition.js";
import {
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import {
  addConfiguredLayerToDeck,
  createDeck,
  getDeck,
} from "../models/deck.js";
import type {
  ConfiguredLayer,
  Deck,
  DeckJson,
  Environment,
  LayerExportEntry,
  MultiLayerExport,
  Layer,
  Plugin,
  Resource,
} from "../types.js";
import { writeEmbeddedPluginsOnImport } from "./plugin-layer-export.js";
import {
  importDeckEnvironment,
  type ImportDeckJsonOptions,
} from "./deck-export-import.js";
import {
  inspectLayerExportFile,
  parsedLayerExportToDeckJson,
} from "./layer-export.js";

export interface ImportLayerOptions {
  /** When importing a layer export with `embedded_plugins`, write those trees under this directory. */
  embeddedTargetDir?: string;
  /** Override the imported layer name (useful when installing a remote library under a different local name). */
  layerNameOverride?: string;
  /** Override the resource source label recorded on imported resources. */
  resourceSource?: string;
  /** Skip exported layers whose name/version key is not allowed. */
  includeLayers?: (layer: LayerExportEntry) => boolean;
}

export interface ImportedLayerBundleEntry {
  layer: Layer;
  resources: Resource[];
}

export interface ImportedLayerBundle {
  layer: Layer;
  resources: Resource[];
  layers: ImportedLayerBundleEntry[];
}

export interface ImportLayerExportAsDeckResult {
  deck: Deck;
  deckJson: DeckJson;
  plugins: Plugin[];
  configuredLayers: ConfiguredLayer[];
  environments: Environment[];
}

function importLayerFromBundleParsed(
  bundle: LayerExportEntry,
  embeddedPlugins: MultiLayerExport["embedded_plugins"],
  filePath: string,
  opts?: ImportLayerOptions,
): { layer: Layer; resources: Resource[] } {
  const claude = bundle.claude;

  const layer = createLayer({
    name: opts?.layerNameOverride ?? bundle.name,
    version: bundle.version,
    description: bundle.description,
    tags: bundle.tags,
    ...(claude ? { claude } : {}),
  });

  const resources: Resource[] = [];
  for (const r of bundle.resources) {
    if (isCompositionResourceType(r.type)) {
      continue;
    }
    const upserted = upsertResource(
      normalizeResourceInput({
        type: r.type,
        name: r.name,
        description: r.description,
        content: r.content,
        metadata: r.metadata,
        source: opts?.resourceSource ?? `import:${filePath}`,
        namespace: r.namespace,
        origin_kind: r.origin_kind,
        origin_ref: r.origin_ref,
      }),
      { policy: "overwrite" },
    );
    if (upserted.action === "skipped") {
      throw new Error(`Failed to import resource: ${r.type}:${r.name}`);
    }
    addResourceToLayer(layer.id, upserted.resource.id);
    resources.push(upserted.resource);
  }

  const layerId = layer.id;
  const embeddedPluginKeys = new Set(
    (bundle.plugin_pins ?? [])
      .map((pluginPin) => `${pluginPin.ref}\u0000${pluginPin.version_constraint}`)
      .filter((key) =>
        embeddedPlugins.some(
          (plugin) => `${plugin.ref}\u0000${plugin.version_constraint}` === key,
        ),
      ),
  );
  const pluginPins = (bundle.plugin_pins ?? []).filter(
    (pluginPin) => !embeddedPluginKeys.has(`${pluginPin.ref}\u0000${pluginPin.version_constraint}`),
  );
  const layerEmbeddedPlugins = embeddedPlugins.filter((plugin) =>
    embeddedPluginKeys.has(`${plugin.ref}\u0000${plugin.version_constraint}`),
  );

  function syncPinsAfterMutation(ref: string, versionConstraint: string): void {
    const refreshed = getLayer(layerId);
    if (!refreshed) {
      throw new Error(`Layer ${layerId} not found during bundle import`);
    }
    syncClaudeLayerPluginsAfterAdd(refreshed, ref, versionConstraint);
  }

  for (const p of pluginPins) {
    attachPluginPinToLayer(layerId, p.ref, p.version_constraint, {
      embedOnExport: false,
    });
    syncPinsAfterMutation(p.ref, p.version_constraint);
  }

  const embeddedDir = opts?.embeddedTargetDir ?? resolve(process.cwd());
  if (layerEmbeddedPlugins.length > 0) {
    writeEmbeddedPluginsOnImport(embeddedDir, layerEmbeddedPlugins);
    for (const e of layerEmbeddedPlugins) {
      attachPluginPinToLayer(layerId, e.ref, e.version_constraint, {
        embedOnExport: false,
      });
      syncPinsAfterMutation(e.ref, e.version_constraint);
    }
  }

  for (const dep of bundle.dependencies ?? []) {
    addDependencyToLayer(layer.id, dep.dependency_name, dep.version_constraint);
  }

  const finalized = getLayer(layer.id);
  if (!finalized) {
    throw new Error(`Layer ${layer.id} not found after bundle import`);
  }
  return { layer: finalized, resources };
}

/**
 * Import a bundle from a file, creating the layer and resources.
 */
export function importFromFile(
  filePath: string,
  opts?: ImportLayerOptions,
): ImportedLayerBundle {
  const normalized = inspectLayerExportFile(filePath);
  const bundleLayers = normalized.layers.filter((bundleLayer) =>
    opts?.includeLayers ? opts.includeLayers(bundleLayer) : true,
  );
  const layers = bundleLayers.map((bundleLayer, index) =>
    importLayerFromBundleParsed(
      bundleLayer,
      normalized.embedded_plugins,
      filePath,
      {
        ...opts,
        layerNameOverride:
          index === 0 ? opts?.layerNameOverride : undefined,
      },
    ),
  );
  const [firstLayer] = layers;
  if (!firstLayer) {
    throw new Error(`Bundle contains no layers: ${filePath}`);
  }

  return {
    layer: firstLayer.layer,
    resources: firstLayer.resources,
    layers,
  };
}

/**
 * Import layer v1 via the legacy importer, then materialize deck.json structure.
 */
export function importLayerExportAsDeck(
  filePath: string,
  opts?: ImportLayerOptions & {
    deckName?: string;
    rootPath?: string;
    resourceSource?: string;
  },
): ImportLayerExportAsDeckResult {
  const deckJson = parsedLayerExportToDeckJson(inspectLayerExportFile(filePath), {
    deckName: opts?.deckName,
  });

  const imported = importFromFile(filePath, opts);
  const plugins = imported.layers.map((entry) => entry.layer);
  const environments: Environment[] = [];

  for (const environment of deckJson.environments) {
    environments.push(
      importDeckEnvironment(environment, {
        resourceSource: opts?.resourceSource,
      } satisfies ImportDeckJsonOptions),
    );
  }

  const environmentIdsByName = new Map(
    environments.map((environment) => [environment.name, environment.id]),
  );

  const configuredLayers: ConfiguredLayer[] = [];
  for (const entry of imported.layers) {
    const deckLayer = deckJson.layers.find(
      (layer) =>
        layer.name === entry.layer.name && layer.version === entry.layer.version,
    );
    const environmentId = deckLayer?.environment
      ? environmentIdsByName.get(deckLayer.environment)
      : undefined;

    let layer = entry.layer;
    if (environmentId) {
      setLayerDefaultEnvironment(layer.id, environmentId);
      layer = getLayerById(layer.id) ?? layer;
    }
    configuredLayers.push(layer);
  }

  const deck = createDeck({
    name: opts?.deckName ?? deckJson.name,
    rootPath: opts?.rootPath ?? "",
  });

  for (const configuredLayer of configuredLayers) {
    addConfiguredLayerToDeck(deck.id, configuredLayer.id);
  }

  const finalized = getDeck(deck.id);
  if (!finalized) {
    throw new Error(`Deck ${deck.id} not found after layer v1 import`);
  }

  return {
    deck: finalized,
    deckJson,
    plugins,
    configuredLayers,
    environments,
  };
}
