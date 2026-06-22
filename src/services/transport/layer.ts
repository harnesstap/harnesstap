import type {
  LayerExport,
  LayerExportDependency,
  LayerExportEntry,
  LayerExportPluginPin,
  LayerExportResource,
  MultiLayerExport,
} from "../../types.js";
import {
  LAYER_SCHEMA,
  LAYER_SCHEMA_VERSION,
} from "../../types.js";
import {
  embeddedPluginsFromTomlRecord,
  embeddedPluginsToTomlRecord,
} from "./embedded-plugins.js";
import { parseTransportToml } from "./read.js";
import { readSchemaHeader } from "./validate.js";
import { formatTransportToml } from "./write.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseResource(value: unknown): LayerExportResource {
  if (!isRecord(value)) {
    throw new Error("Layer resource must be a table");
  }
  const metadata = isRecord(value.metadata)
    ? value.metadata
    : typeof value.metadata_json === "string"
      ? (JSON.parse(value.metadata_json) as LayerExportResource["metadata"])
      : {};

  return {
    type: String(value.type ?? "") as LayerExportResource["type"],
    name: String(value.name ?? ""),
    description: String(value.description ?? ""),
    content: String(value.content ?? ""),
    metadata,
    namespace: String(value.namespace ?? ""),
    origin_kind: (value.origin_kind ?? "manual") as LayerExportResource["origin_kind"],
    origin_ref: String(value.origin_ref ?? ""),
    content_hash: String(value.content_hash ?? ""),
    content_blob_ref: String(value.content_blob_ref ?? ""),
  };
}

function serializeResource(resource: LayerExportResource): Record<string, unknown> {
  const row: Record<string, unknown> = {
    type: resource.type,
    name: resource.name,
    description: resource.description,
    content: resource.content,
    namespace: resource.namespace,
    origin_kind: resource.origin_kind,
    origin_ref: resource.origin_ref,
    content_hash: resource.content_hash,
    content_blob_ref: resource.content_blob_ref,
  };
  if (resource.metadata && Object.keys(resource.metadata).length > 0) {
    row.metadata = resource.metadata;
  }
  return row;
}

function parsePluginPin(value: unknown): LayerExportPluginPin {
  if (!isRecord(value)) {
    throw new Error("Layer plugin pin must be a table");
  }
  return {
    ref: String(value.ref ?? ""),
    version_constraint: String(value.version_constraint ?? "*"),
  };
}

function parseDependency(value: unknown): LayerExportDependency {
  if (!isRecord(value)) {
    throw new Error("Layer dependency must be a table");
  }
  return {
    dependency_name: String(value.dependency_name ?? ""),
    version_constraint: String(value.version_constraint ?? "*"),
    order: typeof value.order === "number" ? value.order : 0,
  };
}

export function parseLayerEntry(value: unknown): LayerExportEntry {
  if (!isRecord(value)) {
    throw new Error("Layer entry must be a table");
  }

  const resources = Array.isArray(value.resources)
    ? value.resources.map(parseResource)
    : [];
  const pluginPins = Array.isArray(value.plugin_pins)
    ? value.plugin_pins.map(parsePluginPin)
    : [];
  const dependencies = Array.isArray(value.dependencies)
    ? value.dependencies.map(parseDependency)
    : undefined;
  const embeddedPluginRefs = Array.isArray(value.embedded_plugin_refs)
    ? value.embedded_plugin_refs.map(String)
    : undefined;

  return {
    name: String(value.name ?? ""),
    version: String(value.version ?? "1.0.0"),
    description: String(value.description ?? ""),
    tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
    resources,
    plugin_pins: pluginPins,
    ...(value.claude && isRecord(value.claude)
      ? { claude: value.claude as LayerExportEntry["claude"] }
      : {}),
    ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
    ...(embeddedPluginRefs && embeddedPluginRefs.length > 0
      ? { embedded_plugin_refs: embeddedPluginRefs }
      : {}),
  };
}

export function serializeLayerEntry(layer: LayerExportEntry): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: layer.name,
    version: layer.version,
    description: layer.description,
    tags: [...layer.tags],
    resources: layer.resources.map(serializeResource),
    plugin_pins: layer.plugin_pins.map((pluginPin) => ({
      ref: pluginPin.ref,
      version_constraint: pluginPin.version_constraint,
    })),
  };
  if (layer.dependencies && layer.dependencies.length > 0) {
    row.dependencies = layer.dependencies.map((dependency) => ({
      dependency_name: dependency.dependency_name,
      version_constraint: dependency.version_constraint,
      order: dependency.order,
    }));
  }
  if (layer.embedded_plugin_refs && layer.embedded_plugin_refs.length > 0) {
    row.embedded_plugin_refs = [...layer.embedded_plugin_refs];
  }
  if (layer.claude) {
    row.claude = layer.claude;
  }
  return row;
}

export function normalizeLayerExportForToml(bundle: LayerExport): {
  layers: LayerExportEntry[];
  embedded_plugins: MultiLayerExport["embedded_plugins"];
} {
  return {
    layers: bundle.layers.map((layer) => ({
      ...layer,
      plugin_pins: [...(layer.plugin_pins ?? [])],
      resources: [...layer.resources],
    })),
    embedded_plugins: bundle.embedded_plugins ?? [],
  };
}

export function layerExportToTomlDocument(bundle: LayerExport): Record<string, unknown> {
  const normalized = normalizeLayerExportForToml(bundle);
  const document: Record<string, unknown> = {
    schema: LAYER_SCHEMA,
    version: LAYER_SCHEMA_VERSION,
    layers: normalized.layers
      .map(serializeLayerEntry)
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
  };
  if (normalized.embedded_plugins.length > 0) {
    document.embedded_plugins = embeddedPluginsToTomlRecord(
      normalized.embedded_plugins,
    );
  }
  return document;
}

export function layerExportFromTomlDocument(
  document: Record<string, unknown>,
): MultiLayerExport {
  const layersRaw = document.layers;
  if (!Array.isArray(layersRaw) || layersRaw.length === 0) {
    throw new Error("Layer export must include at least one [[layers]] entry");
  }

  return {
    $schema: LAYER_SCHEMA,
    version: LAYER_SCHEMA_VERSION,
    layers: layersRaw.map(parseLayerEntry),
    embedded_plugins: embeddedPluginsFromTomlRecord(document.embedded_plugins),
  };
}

export function parseLayerExportToml(raw: string): MultiLayerExport {
  const document = parseTransportToml(raw, "layer export");
  const { schema, version } = readSchemaHeader(document);
  if (schema !== LAYER_SCHEMA) {
    throw new Error(`Unsupported layer schema: ${schema}`);
  }
  if (version !== LAYER_SCHEMA_VERSION) {
    throw new Error(`Unsupported layer version: ${version}`);
  }
  return layerExportFromTomlDocument(document);
}

export function formatLayerExportToml(bundle: LayerExport): string {
  const layerNames = normalizeLayerExportForToml(bundle).layers.map(
    (layer) => layer.name,
  );
  const sourceMachine = process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? "unknown";
  const header = [
    "# HarnessDeck layer export",
    `# Layers: ${layerNames.join(", ")}`,
    `# Generated at: ${new Date().toISOString()}`,
    `# Source machine: ${sourceMachine}`,
    "",
  ].join("\n");
  return `${header}${formatTransportToml(layerExportToTomlDocument(bundle))}`;
}
