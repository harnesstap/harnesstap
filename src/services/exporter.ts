import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import {
  getPlugin,
  getPluginResources,
  createPlugin,
  addResourceToPlugin,
  syncClaudeLayerPluginsAfterAdd,
  listPluginDependencies,
  addDependencyToPlugin,
} from "../models/plugin-component.js";
import { listLayerPlugins, addPluginToLayer } from "../models/plugin-pins.js";
import { isCompositionResourceType } from "./composition-resource.js";
import type { LayerPluginRow } from "../models/plugin-pins.js";
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
import { createConfiguredLayer } from "../models/configured-layer.js";
import {
  getLayerById,
  getLayerByPublishedIdentity,
  setLayerDefaultEnvironment,
} from "../models/layer-model.js";
import {
  addResourceToEnvironment,
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironment,
  getEnvironmentByName,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
} from "../models/environment.js";
import { loadInstalled } from "../plugins/claude-installed.js";
import type {
  ConfiguredLayer,
  Deck,
  DeckJson,
  DeckJsonEnvironment,
  DeckJsonEnvironmentSecretRef,
  DeckJsonExportOptions,
  DeckJsonLayer,
  DeckJsonLayerPluginRef,
  EnvVarMetadata,
  Environment,
  ExportBundle,
  ExportBundleDependency,
  ExportBundleLayer,
  ExportBundleLayerEntry,
  ExportBundleLayerPluginPin,
  ExportBundleResource,
  LegacyExportBundle,
  MultiLayerExportBundle,
  Layer,
  Plugin,
  Resource,
} from "../types.js";
import {
  BUNDLE_SCHEMA,
  BUNDLE_VERSION,
  DECK_JSON_VERSION,
  DECK_SCHEMA,
} from "../types.js";
import {
  ENVIRONMENT_RESOURCE_TYPES,
  PLUGIN_RESOURCE_TYPES,
} from "./resource-classification.js";
import { collectEmbeddedPluginFiles, writeEmbeddedPluginsOnImport } from "./plugin-bundle.js";

export interface ExportLayerOptions {
  /** When true, embed marketplace-installed plugins too if their install paths resolve from `HOME`. */
  embedPlugins?: boolean;
  projectRoot?: string;
  /** Defaults to `$HOME`; used only to locate installed Claude marketplace plugins when embedding them. */
  homeRoot?: string;
}

export interface ImportLayerOptions {
  /** When importing a bundle with `embedded_plugins`, write those trees under this directory. */
  embeddedTargetDir?: string;
  /** Override the imported layer name (useful when installing a remote library under a different local name). */
  layerNameOverride?: string;
  /** Override the resource source label recorded on imported resources. */
  resourceSource?: string;
  /** Skip bundle layers whose name/version key is not allowed. */
  includeLayers?: (layer: ExportBundleLayerEntry) => boolean;
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

export interface ImportDeckJsonResult {
  deck: Deck;
  plugins: Plugin[];
  configuredLayers: ConfiguredLayer[];
  environments: Environment[];
}

export interface ImportBundleV1AsDeckResult {
  deck: Deck;
  deckJson: DeckJson;
  plugins: Plugin[];
  configuredLayers: ConfiguredLayer[];
  environments: Environment[];
}

export interface ImportDeckJsonOptions {
  rootPath?: string;
  resourceSource?: string;
  deckNameOverride?: string;
}

type ExportLayerSelector = string | string[];

interface NormalizedExportBundle {
  embedded_plugins: LegacyExportBundle["embedded_plugins"];
  layers: ExportBundleLayerEntry[];
  multiLayer: boolean;
}

interface ExportBundlePayloadWithEmbedded extends ExportBundleLayerEntry {
  embedded_plugins: LegacyExportBundle["embedded_plugins"];
}

interface ParsedBundleSummary {
  layers: ExportBundleLayerEntry[];
  embedded_plugins: LegacyExportBundle["embedded_plugins"];
  multiLayer: boolean;
}

function resolveHomeRoot(opts?: ExportLayerOptions): string {
  if (opts?.homeRoot && opts.homeRoot.length > 0) return opts.homeRoot;
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function resolveProjectRoot(opts?: ExportLayerOptions): string {
  if (opts?.projectRoot && opts.projectRoot.length > 0)
    return resolve(opts.projectRoot);
  return resolve(process.cwd());
}

function isProjectRelativeRef(ref: string): boolean {
  return ref.startsWith("./") || ref.startsWith(".\\");
}

function projectRelativePluginRoot(
  ref: string,
  projectRoot: string,
): string | undefined {
  const rel = ref.startsWith("./")
    ? ref.slice(2)
    : ref.startsWith(".\\")
      ? ref.slice(2).replace(/\\/g, "/")
      : "";
  const abs = resolve(projectRoot, rel);
  if (!existsSync(abs)) return undefined;
  try {
    if (!statSync(abs).isDirectory()) return undefined;
    return resolve(abs);
  } catch {
    return undefined;
  }
}

function marketplaceInstallRoot(ref: string, homeRoot: string): string | undefined {
  if (!homeRoot) return undefined;
  const installs = loadInstalled(homeRoot);
  const match = installs.find((i) => i.ref === ref);
  if (match?.installPath && existsSync(match.installPath)) {
    try {
      const st = statSync(match.installPath);
      if (!st.isDirectory()) return undefined;
      return resolve(match.installPath);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function resolveEmbedPluginRootAbs(
  ref: string,
  projectRoot: string,
  homeRoot: string,
): string | undefined {
  if (isProjectRelativeRef(ref)) {
    return projectRelativePluginRoot(ref, projectRoot);
  }
  return marketplaceInstallRoot(ref, homeRoot);
}

function classifyLayerPluginsForExport(
  rows: LayerPluginRow[],
  opts?: ExportLayerOptions,
): {
  pins: ExportBundleLayerPluginPin[];
  embeddedRoots: ExportBundle["embedded_plugins"];
} {
  const projectRoot = resolveProjectRoot(opts);
  const homeRoot = resolveHomeRoot(opts);
  const optEmbedMarketplace = opts?.embedPlugins ?? false;
  const pins: ExportBundleLayerPluginPin[] = [];
  const embeddedRoots: ExportBundle["embedded_plugins"] = [];

  for (const row of rows) {
    const marketplaceAbs = marketplaceInstallRoot(row.ref, homeRoot);
    const mustEmbedFilesystem =
      isProjectRelativeRef(row.ref) ||
      row.embed_on_export ||
      (optEmbedMarketplace && marketplaceAbs !== undefined);

    if (mustEmbedFilesystem) {
      const rootAbs = resolveEmbedPluginRootAbs(row.ref, projectRoot, homeRoot);
      if (!rootAbs) {
        throw new Error(
          `Unable to embed plugin "${row.ref}": resolved install directory not found (cwd/project: ${projectRoot}).`,
        );
      }
      const files = collectEmbeddedPluginFiles(rootAbs);
      embeddedRoots.push({
        ref: row.ref,
        version_constraint: row.version_constraint,
        root: basename(rootAbs),
        files,
      });
      continue;
    }

    pins.push({
      ref: row.ref,
      version_constraint: row.version_constraint,
    });
  }

  return { pins, embeddedRoots };
}

function toExportBundleLayer(layer: Layer): ExportBundleLayer {
  return {
    name: layer.name,
    version: layer.version,
    description: layer.description,
    tags: layer.tags,
    ...(layer.claude ? { claude: layer.claude } : {}),
  };
}

function collectBundlePayload(
  layer: Layer,
  exportOpts?: ExportLayerOptions,
): ExportBundlePayloadWithEmbedded {
  const resources = getPluginResources(layer.id);
  const layerRows = listLayerPlugins(layer.id);
  const deps = listPluginDependencies(layer.id);
  const { pins, embeddedRoots } = classifyLayerPluginsForExport(
    layerRows,
    exportOpts,
  );

  const payload: ExportBundlePayloadWithEmbedded = {
    name: layer.name,
    version: layer.version,
    description: layer.description,
    tags: layer.tags,
    ...(layer.claude ? { claude: layer.claude } : {}),
    resources: resources
      .filter((r) => !isCompositionResourceType(r.type))
      .map((r) => ({
        type: r.type,
        name: r.name,
        description: r.description,
        content: r.content,
        metadata: r.metadata,
        namespace: r.namespace,
        origin_kind: r.origin_kind,
        origin_ref: r.origin_ref,
        content_hash: r.content_hash,
        content_blob_ref: r.content_blob_ref,
      })),
    plugins: pins,
    ...(embeddedRoots.length > 0
      ? { embedded_plugin_refs: embeddedRoots.map((plugin) => plugin.ref) }
      : {}),
    embedded_plugins: embeddedRoots,
    ...(deps.length > 0
      ? {
          dependencies: deps.map((d) => ({
            dependency_name: d.dependency_name,
            version_constraint: d.version_constraint,
            order: d.order,
          } satisfies ExportBundleDependency)),
        }
      : {}),
  };

  return payload;
}

function normalizeExportBundle(bundle: ExportBundle): NormalizedExportBundle {
  if ("layers" in bundle) {
    return {
      embedded_plugins: bundle.embedded_plugins ?? [],
      layers: bundle.layers.map((layer) => ({
        ...layer,
        plugins: [...(layer.plugins ?? [])],
      })),
      multiLayer: true,
    };
  }

  const { embedded_plugins, ...layerPayload } = bundle;
  const singleLayer = layerPayload.layer;
  return {
    embedded_plugins: embedded_plugins ?? [],
      layers: [
        {
          ...singleLayer,
          plugins: [...(layerPayload.plugins ?? [])],
          resources: layerPayload.resources,
          ...(layerPayload.claude ? { claude: layerPayload.claude } : {}),
          ...(layerPayload.dependencies ? { dependencies: layerPayload.dependencies } : {}),
        },
      ],
      multiLayer: false,
  };
}

function parseBundle(raw: string): ParsedBundleSummary {
  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as Record<string, unknown>;

  if (parseErrors.length > 0) {
    const [firstError] = parseErrors;
    const detail = firstError
      ? `${printParseErrorCode(firstError.error)} at offset ${firstError.offset}`
      : "invalid JSONC";
    throw new Error(`Invalid bundle JSONC: ${detail}`);
  }

  if (parsed.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${parsed.version}`);
  }

  return normalizeExportBundle(parsed as unknown as ExportBundle);
}

export function inspectBundleFile(filePath: string): ParsedBundleSummary {
  return parseBundle(readFileSync(filePath, "utf-8"));
}

function formatBundleAsJsonc(bundle: ExportBundle): string {
  const layerNames = "layers" in bundle
    ? bundle.layers.map((layer) => layer.name)
    : [bundle.layer.name];
  const sourceMachine = process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? "unknown";

  return [
    "/*",
    " * HarnessDeck layer bundle",
    ` * Layers: ${layerNames.join(", ")}`,
    ` * Generated at: ${new Date().toISOString()}`,
    ` * Source machine: ${sourceMachine}`,
    " */",
    JSON.stringify(bundle, null, 2),
  ].join("\n");
}

/**
 * Export a layer and its resources as a portable JSON bundle.
 */
function isEnvironmentResourceType(type: string): boolean {
  return (ENVIRONMENT_RESOURCE_TYPES as readonly string[]).includes(type);
}

function isPluginResourceType(type: string): boolean {
  return (PLUGIN_RESOURCE_TYPES as readonly string[]).includes(type);
}

function splitBundleResources(resources: ExportBundleResource[]): {
  pluginResources: ExportBundleResource[];
  environmentResources: ExportBundleResource[];
} {
  const pluginResources: ExportBundleResource[] = [];
  const environmentResources: ExportBundleResource[] = [];

  for (const resource of resources) {
    if (isEnvironmentResourceType(resource.type)) {
      environmentResources.push(resource);
    } else if (isPluginResourceType(resource.type)) {
      pluginResources.push(resource);
    } else {
      pluginResources.push(resource);
    }
  }

  return { pluginResources, environmentResources };
}

function environmentResourcesToDeckJson(
  envName: string,
  resources: ExportBundleResource[],
): DeckJsonEnvironment | undefined {
  const values: Record<string, string> = {};

  for (const resource of resources) {
    if (resource.type === "env_var") {
      const meta = resource.metadata as EnvVarMetadata;
      values[meta.key] = meta.value;
    }
  }

  if (Object.keys(values).length === 0) {
    return undefined;
  }

  return { name: envName, values };
}

function defaultEnvironmentNameForLayer(layerName: string): string {
  return `${layerName}-env`;
}

function isSelectorOnlyExport(options?: DeckJsonExportOptions): boolean {
  return options?.selectorOnly !== false;
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

function parsedBundleToDeckJson(
  normalized: NormalizedExportBundle,
  options?: DeckJsonExportOptions,
): DeckJson {
  const selectorOnly = isSelectorOnlyExport(options);
  const environmentsByName = new Map<string, DeckJsonEnvironment>();
  const deckLayers: DeckJsonLayer[] = [];

  for (const layer of normalized.layers) {
    const version =
      typeof layer.version === "string" && layer.version.length > 0
        ? layer.version
        : "1.0.0";
    const { environmentResources } = splitBundleResources(layer.resources);
    const envName = defaultEnvironmentNameForLayer(layer.name);
    const envEntry = environmentResourcesToDeckJson(
      envName,
      environmentResources,
    );
    let layerEnvironment: string | undefined;
    if (envEntry) {
      environmentsByName.set(envEntry.name, envEntry);
      layerEnvironment = envEntry.name;
    }

    deckLayers.push(
      layerToDeckJsonEntry(
        {
          id: "",
          name: layer.name,
          version,
          org_slug: "",
          catalog_slug: "",
          description: layer.description ?? "",
          tags: layer.tags ?? [],
          created_at: "",
          updated_at: "",
        },
        layerEnvironment,
        selectorOnly,
      ),
    );
  }

  const [firstLayer] = normalized.layers;
  const deckName =
    options?.deckName ?? firstLayer?.name ?? "imported-deck";

  return {
    $schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: deckName,
    layers: deckLayers,
    environments: [...environmentsByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}

/**
 * Convert a bundle v1 export into canonical deck.json (plugins + configured layers).
 */
export function bundleV1ToDeckJson(
  bundle: ExportBundle,
  options?: DeckJsonExportOptions,
): DeckJson {
  return parsedBundleToDeckJson(normalizeExportBundle(bundle), options);
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

function parseDeckJsonFile(raw: string): DeckJson {
  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as Record<string, unknown>;

  if (parseErrors.length > 0) {
    const [firstError] = parseErrors;
    const detail = firstError
      ? `${printParseErrorCode(firstError.error)} at offset ${firstError.offset}`
      : "invalid JSONC";
    throw new Error(`Invalid deck JSONC: ${detail}`);
  }

  if (parsed.$schema !== DECK_SCHEMA) {
    throw new Error(`Unsupported deck schema: ${parsed.$schema}`);
  }
  if (parsed.version !== DECK_JSON_VERSION) {
    throw new Error(`Unsupported deck version: ${parsed.version}`);
  }

  return parsed as unknown as DeckJson;
}

export function readDeckJson(filePath: string): DeckJson {
  return parseDeckJsonFile(readFileSync(filePath, "utf-8"));
}

function resolvePluginRef(ref: DeckJsonLayerPluginRef): Plugin {
  const plugin =
    getPlugin(`${ref.name}@${ref.version}`) ?? getPlugin(ref.name);
  if (!plugin) {
    throw new Error(
      `Plugin not found for deck import: ${ref.name}@${ref.version}`,
    );
  }
  return plugin;
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
  if (layer.plugins && layer.plugins.length > 0) {
    const pluginIds: string[] = [];
    for (const ref of layer.plugins) {
      const plugin = resolvePluginRef(ref);
      pluginIds.push(plugin.id);
    }
    return createConfiguredLayer({
      name: layer.name,
      version: layer.version,
      pluginIds,
    });
  }

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

function importDeckEnvironment(
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
        source: opts?.resourceSource ?? "import:deck.json",
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
 * Import deck.json into the database (plugins must already exist).
 */
export function importDeckJson(
  filePath: string,
  opts?: ImportDeckJsonOptions,
): ImportDeckJsonResult {
  const deckJson = readDeckJson(filePath);
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

    if (layer.plugins && layer.plugins.length > 0) {
      for (const ref of layer.plugins) {
        const plugin = resolvePluginRef(ref);
        if (!plugins.some((entry) => entry.id === plugin.id)) {
          plugins.push(plugin);
        }
      }
    }

    const refreshed = getLayerById(resolvedLayer.id);
    if (!refreshed) {
      throw new Error(`Layer ${resolvedLayer.id} not found after deck.json import`);
    }
    configuredLayers.push(refreshed);
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
    throw new Error(`Deck ${deck.id} not found after deck.json import`);
  }

  return {
    deck: finalized,
    plugins,
    configuredLayers,
    environments,
  };
}

/**
 * Import bundle v1 via the legacy importer, then materialize deck.json structure.
 */
export function importBundleV1AsDeck(
  filePath: string,
  opts?: ImportLayerOptions & {
    deckName?: string;
    rootPath?: string;
    resourceSource?: string;
  },
): ImportBundleV1AsDeckResult {
  const deckJson = parsedBundleToDeckJson(inspectBundleFile(filePath), {
    deckName: opts?.deckName,
  });

  const imported = importFromFile(filePath, opts);
  const plugins = imported.layers.map((entry) => entry.layer);
  const environments: Environment[] = [];

  for (const environment of deckJson.environments) {
    environments.push(
      importDeckEnvironment(environment, {
        resourceSource: opts?.resourceSource,
      }),
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
    throw new Error(`Deck ${deck.id} not found after bundle v1 import`);
  }

  return {
    deck: finalized,
    deckJson,
    plugins,
    configuredLayers,
    environments,
  };
}

export function writeDeckJson(filePath: string, deckJson: DeckJson): void {
  writeFileSync(filePath, `${JSON.stringify(deckJson, null, 2)}\n`, "utf-8");
}

/**
 * Export a layer and its resources as a portable JSON bundle.
 */
export function exportLayer(
  layerNameOrId: ExportLayerSelector,
  exportOpts?: ExportLayerOptions,
): ExportBundle {
  process.stderr.write(
    "Warning: exportLayer writes bundle v1 (urn:harnessdeck:bundle:v1). Prefer deck.json export for new decks.\n",
  );
  const selectors = Array.isArray(layerNameOrId) ? layerNameOrId : [layerNameOrId];
  const layers = selectors.map((selector) => {
    const layer = getPlugin(selector);
    if (!layer) throw new Error(`Layer not found: ${selector}`);
    return layer;
  });
  const payloads = layers.map((layer) => collectBundlePayload(layer, exportOpts));

  if (payloads.length === 1) {
    const [payload] = payloads;
    if (!payload) {
      throw new Error("Expected a bundle payload for export");
    }
    return {
      $schema: BUNDLE_SCHEMA,
      version: BUNDLE_VERSION,
      layer: toExportBundleLayer({
        id: "",
        name: payload.name,
        version: payload.version,
        org_slug: "",
        catalog_slug: "",
        description: payload.description,
        tags: payload.tags,
        ...(payload.claude ? { claude: payload.claude } : {}),
        created_at: "",
        updated_at: "",
      }),
      resources: payload.resources,
      ...(payload.claude ? { claude: payload.claude } : {}),
      plugins: payload.plugins,
      embedded_plugins: payload.embedded_plugins,
      ...(payload.dependencies ? { dependencies: payload.dependencies } : {}),
    } satisfies LegacyExportBundle;
  }

  const embeddedPluginsByKey = new Map<string, LegacyExportBundle["embedded_plugins"][number]>();
  for (const payload of payloads) {
    for (const plugin of payload.embedded_plugins) {
      const key = `${plugin.ref}\u0000${plugin.version_constraint}`;
      if (!embeddedPluginsByKey.has(key)) {
        embeddedPluginsByKey.set(key, plugin);
      }
    }
  }

  return {
    $schema: BUNDLE_SCHEMA,
    version: BUNDLE_VERSION,
    layers: payloads.map(({ embedded_plugins: _embeddedPlugins, ...payload }) => ({
      ...payload,
      plugins: [
        ...payload.plugins,
        ..._embeddedPlugins.map((plugin) => ({
          ref: plugin.ref,
          version_constraint: plugin.version_constraint,
        })),
      ],
    })),
    embedded_plugins: [...embeddedPluginsByKey.values()],
  } satisfies MultiLayerExportBundle;
}

/**
 * Write a bundle to a file.
 */
export function exportToFile(
  layerNameOrId: ExportLayerSelector,
  filePath: string,
  exportOpts?: ExportLayerOptions,
): void {
  const bundle = exportLayer(layerNameOrId, exportOpts);
  const content = extname(filePath).toLowerCase() === ".jsonc"
    ? formatBundleAsJsonc(bundle)
    : JSON.stringify(bundle, null, 2);
  writeFileSync(filePath, content, "utf-8");
}

function importLayerFromBundleParsed(
  bundle: ExportBundleLayerEntry,
  embeddedPlugins: LegacyExportBundle["embedded_plugins"],
  useLegacyEmbeddedFallback: boolean,
  filePath: string,
  opts?: ImportLayerOptions,
): { layer: Layer; resources: Resource[] } {
  const claude = bundle.claude;

  const layer = createPlugin({
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
    addResourceToPlugin(layer.id, upserted.resource.id);
    resources.push(upserted.resource);
  }

  const layerId = layer.id;
  const embeddedPluginKeys = new Set(
    useLegacyEmbeddedFallback
      ? embeddedPlugins.map((plugin) => `${plugin.ref}\u0000${plugin.version_constraint}`)
      : (bundle.plugins ?? [])
          .map((plugin) => `${plugin.ref}\u0000${plugin.version_constraint}`)
          .filter((key) =>
            embeddedPlugins.some(
              (plugin) => `${plugin.ref}\u0000${plugin.version_constraint}` === key,
            ),
          ),
  );
  const pluginPins = (bundle.plugins ?? []).filter(
    (plugin) => !embeddedPluginKeys.has(`${plugin.ref}\u0000${plugin.version_constraint}`),
  );
  const layerEmbeddedPlugins = embeddedPlugins.filter((plugin) =>
    embeddedPluginKeys.has(`${plugin.ref}\u0000${plugin.version_constraint}`),
  );

  function syncPinsAfterMutation(ref: string, versionConstraint: string): void {
    const refreshed = getPlugin(layerId);
    if (!refreshed) {
      throw new Error(`Layer ${layerId} not found during bundle import`);
    }
    syncClaudeLayerPluginsAfterAdd(refreshed, ref, versionConstraint);
  }

  for (const p of pluginPins) {
    addPluginToLayer(layerId, p.ref, p.version_constraint, {
      embedOnExport: false,
    });
    syncPinsAfterMutation(p.ref, p.version_constraint);
  }

  const embeddedDir = opts?.embeddedTargetDir ?? resolve(process.cwd());
  if (layerEmbeddedPlugins.length > 0) {
    writeEmbeddedPluginsOnImport(embeddedDir, layerEmbeddedPlugins);
    for (const e of layerEmbeddedPlugins) {
      addPluginToLayer(layerId, e.ref, e.version_constraint, {
        /** Pin only; inlined trees live in `embedded_plugins` on the bundle, not persisted as “always embed”. */
        embedOnExport: false,
      });
      syncPinsAfterMutation(e.ref, e.version_constraint);
    }
  }

  for (const dep of bundle.dependencies ?? []) {
    addDependencyToPlugin(layer.id, dep.dependency_name, dep.version_constraint);
  }

  const finalized = getPlugin(layer.id);
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
) : ImportedLayerBundle {
  const normalized = inspectBundleFile(filePath);
  const bundleLayers = normalized.layers.filter((bundleLayer) =>
    opts?.includeLayers ? opts.includeLayers(bundleLayer) : true,
  );
  const layers = bundleLayers.map((bundleLayer, index) =>
    importLayerFromBundleParsed(
      bundleLayer,
      normalized.embedded_plugins,
      !normalized.multiLayer,
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
