import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  getLayer,
  getLayerResources,
  listLayerDependencies,
} from "../models/layer-model.js";
import { listLayerPlugins } from "./layer-composition.js";
import { isCompositionResourceType } from "./layer-composition.js";
import type { LayerPluginRow } from "./layer-composition.js";
import { loadInstalled } from "../plugins/claude-installed.js";
import type {
  DeckJson,
  DeckJsonEnvironment,
  DeckJsonExportOptions,
  DeckJsonLayer,
  EnvVarMetadata,
  LayerExportDependency,
  LayerExportEntry,
  LayerExportPluginPin,
  LayerExportResource,
  Layer,
  MultiLayerExport,
} from "../types.js";
import {
  LAYER_SCHEMA,
  LAYER_SCHEMA_VERSION,
  DECK_JSON_VERSION,
  DECK_SCHEMA,
} from "../types.js";
import {
  CONTEXT_SIDE_RESOURCE_TYPES,
  ENVIRONMENT_RESOURCE_TYPES,
} from "./resource-classification.js";
import { collectEmbeddedPluginFiles } from "./plugin-layer-export.js";
import {
  assertTransportExtension,
  formatLayerExportToml,
  parseLayerExportToml,
  readTransportFile,
} from "./transport/index.js";

export interface ExportLayerOptions {
  /** When true, embed marketplace-installed plugins too if their install paths resolve from `HOME`. */
  embedPlugins?: boolean;
  projectRoot?: string;
  /** Defaults to `$HOME`; used only to locate installed Claude marketplace plugins when embedding them. */
  homeRoot?: string;
}

export interface ParsedLayerExportSummary {
  layers: LayerExportEntry[];
  embedded_plugins: MultiLayerExport["embedded_plugins"];
  multiLayer: boolean;
}

type ExportLayerSelector = string | string[];

interface NormalizedLayerExport {
  embedded_plugins: MultiLayerExport["embedded_plugins"];
  layers: LayerExportEntry[];
  multiLayer: boolean;
}

interface LayerExportPayloadWithEmbedded extends LayerExportEntry {
  embedded_plugins: MultiLayerExport["embedded_plugins"];
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
  pins: LayerExportPluginPin[];
  embeddedRoots: MultiLayerExport["embedded_plugins"];
} {
  const projectRoot = resolveProjectRoot(opts);
  const homeRoot = resolveHomeRoot(opts);
  const optEmbedMarketplace = opts?.embedPlugins ?? false;
  const pins: LayerExportPluginPin[] = [];
  const embeddedRoots: MultiLayerExport["embedded_plugins"] = [];

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

function collectBundlePayload(
  layer: Layer,
  exportOpts?: ExportLayerOptions,
): LayerExportPayloadWithEmbedded {
  const resources = getLayerResources(layer.id);
  const layerRows = listLayerPlugins(layer.id);
  const deps = listLayerDependencies(layer.id);
  const { pins, embeddedRoots } = classifyLayerPluginsForExport(
    layerRows,
    exportOpts,
  );

  const payload: LayerExportPayloadWithEmbedded = {
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
    plugin_pins: pins,
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
          } satisfies LayerExportDependency)),
        }
      : {}),
  };

  return payload;
}

function normalizeLayerExport(bundle: MultiLayerExport): NormalizedLayerExport {
  return {
    embedded_plugins: bundle.embedded_plugins ?? [],
    layers: bundle.layers.map((layer) => ({
      ...layer,
      plugin_pins: [...(layer.plugin_pins ?? [])],
    })),
    multiLayer: bundle.layers.length > 1,
  };
}

function parseLayerExport(raw: string): ParsedLayerExportSummary {
  const multi = parseLayerExportToml(raw);
  return {
    layers: multi.layers.map((layer) => ({
      ...layer,
      plugin_pins: [...(layer.plugin_pins ?? [])],
    })),
    embedded_plugins: multi.embedded_plugins ?? [],
    multiLayer: multi.layers.length > 1,
  };
}

export function inspectLayerExportFile(filePath: string): ParsedLayerExportSummary {
  return parseLayerExport(readTransportFile(filePath));
}

function isEnvironmentResourceType(type: string): boolean {
  return (ENVIRONMENT_RESOURCE_TYPES as readonly string[]).includes(type);
}

function isContextSideResourceType(type: string): boolean {
  return (CONTEXT_SIDE_RESOURCE_TYPES as readonly string[]).includes(type);
}

function splitLayerExportResources(resources: LayerExportResource[]): {
  pluginResources: LayerExportResource[];
  environmentResources: LayerExportResource[];
} {
  const pluginResources: LayerExportResource[] = [];
  const environmentResources: LayerExportResource[] = [];

  for (const resource of resources) {
    if (isEnvironmentResourceType(resource.type)) {
      environmentResources.push(resource);
    } else if (isContextSideResourceType(resource.type)) {
      pluginResources.push(resource);
    } else {
      pluginResources.push(resource);
    }
  }

  return { pluginResources, environmentResources };
}

function environmentResourcesToDeckJson(
  envName: string,
  resources: LayerExportResource[],
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

function layerToDeckJsonEntry(
  layer: Layer,
  layerEnvironment: string | undefined,
): DeckJsonLayer {
  return {
    name: layer.name,
    version: layer.version,
    ...(layer.org_slug ? { org: layer.org_slug } : {}),
    ...(layer.catalog_slug ? { catalog: layer.catalog_slug } : {}),
    ...(layerEnvironment ? { environment: layerEnvironment } : {}),
  };
}

export function parsedLayerExportToDeckJson(
  normalized: ParsedLayerExportSummary,
  options?: DeckJsonExportOptions,
): DeckJson {
  const environmentsByName = new Map<string, DeckJsonEnvironment>();
  const deckLayers: DeckJsonLayer[] = [];

  for (const layer of normalized.layers) {
    const version =
      typeof layer.version === "string" && layer.version.length > 0
        ? layer.version
        : "1.0.0";
    const { environmentResources } = splitLayerExportResources(layer.resources);
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
 * Convert a layer v1 export into canonical deck.json (plugins + configured layers).
 */
export function layerExportToDeckJson(
  bundle: MultiLayerExport,
  options?: DeckJsonExportOptions,
): DeckJson {
  return parsedLayerExportToDeckJson(normalizeLayerExport(bundle), options);
}

function buildMultiLayerExport(
  payloads: LayerExportPayloadWithEmbedded[],
): MultiLayerExport {
  const embeddedPluginsByKey = new Map<
    string,
    MultiLayerExport["embedded_plugins"][number]
  >();
  for (const payload of payloads) {
    for (const plugin of payload.embedded_plugins) {
      const key = `${plugin.ref}\u0000${plugin.version_constraint}`;
      if (!embeddedPluginsByKey.has(key)) {
        embeddedPluginsByKey.set(key, plugin);
      }
    }
  }

  return {
    $schema: LAYER_SCHEMA,
    version: LAYER_SCHEMA_VERSION,
    layers: payloads.map(({ embedded_plugins: embeddedPlugins, ...payload }) => ({
      ...payload,
      plugin_pins: [
        ...payload.plugin_pins,
        ...embeddedPlugins.map((plugin) => ({
          ref: plugin.ref,
          version_constraint: plugin.version_constraint,
        })),
      ],
    })),
    embedded_plugins: [...embeddedPluginsByKey.values()],
  };
}

/**
 * Export a layer and its resources as a portable TOML bundle.
 */
export function exportLayer(
  layerNameOrId: ExportLayerSelector,
  exportOpts?: ExportLayerOptions,
): MultiLayerExport {
  process.stderr.write(
    "Warning: exportLayer writes layer v1 (urn:harnessdeck:layer:v1). Prefer migrate export --layer for sharing.\n",
  );
  const selectors = Array.isArray(layerNameOrId) ? layerNameOrId : [layerNameOrId];
  const layers = selectors.map((selector) => {
    const layer = getLayer(selector);
    if (!layer) throw new Error(`Layer not found: ${selector}`);
    return layer;
  });
  const payloads = layers.map((layer) => collectBundlePayload(layer, exportOpts));
  return buildMultiLayerExport(payloads);
}

/**
 * Write a bundle to a file.
 */
export function exportToFile(
  layerNameOrId: ExportLayerSelector,
  filePath: string,
  exportOpts?: ExportLayerOptions,
): void {
  assertTransportExtension(filePath);
  const bundle = exportLayer(layerNameOrId, exportOpts);
  writeFileSync(filePath, formatLayerExportToml(bundle), "utf-8");
}
