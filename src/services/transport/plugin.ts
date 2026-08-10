import type {
  PluginExport,
  PluginExportDependency,
  PluginExportEntry,
  PluginExportPluginPin,
  PluginExportResource,
  MultiPluginExport,
} from "../../types.js";
import {
  PLUGIN_SCHEMA,
  PLUGIN_SCHEMA_VERSION,
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

function parseResource(value: unknown): PluginExportResource {
  if (!isRecord(value)) {
    throw new Error("Plugin resource must be a table");
  }
  const metadata = isRecord(value.metadata)
    ? value.metadata
    : typeof value.metadata_json === "string"
      ? (JSON.parse(value.metadata_json) as PluginExportResource["metadata"])
      : {};

  return {
    type: String(value.type ?? "") as PluginExportResource["type"],
    name: String(value.name ?? ""),
    description: String(value.description ?? ""),
    content: String(value.content ?? ""),
    metadata,
    namespace: String(value.namespace ?? ""),
    origin_kind: (value.origin_kind ?? "manual") as PluginExportResource["origin_kind"],
    origin_ref: String(value.origin_ref ?? ""),
    content_hash: String(value.content_hash ?? ""),
    content_blob_ref: String(value.content_blob_ref ?? ""),
  };
}

function serializeResource(resource: PluginExportResource): Record<string, unknown> {
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

function parsePluginPin(value: unknown): PluginExportPluginPin {
  if (!isRecord(value)) {
    throw new Error("Plugin plugin pin must be a table");
  }
  return {
    ref: String(value.ref ?? ""),
    version_constraint: String(value.version_constraint ?? "*"),
  };
}

function parseDependency(value: unknown): PluginExportDependency {
  if (!isRecord(value)) {
    throw new Error("Plugin dependency must be a table");
  }
  return {
    dependency_name: String(value.dependency_name ?? ""),
    version_constraint: String(value.version_constraint ?? "*"),
    order: typeof value.order === "number" ? value.order : 0,
  };
}

export function parsePluginEntry(value: unknown): PluginExportEntry {
  if (!isRecord(value)) {
    throw new Error("Plugin entry must be a table");
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
      ? { claude: value.claude as PluginExportEntry["claude"] }
      : {}),
    ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
    ...(embeddedPluginRefs && embeddedPluginRefs.length > 0
      ? { embedded_plugin_refs: embeddedPluginRefs }
      : {}),
  };
}

export function serializePluginEntry(plugin: PluginExportEntry): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    tags: [...plugin.tags],
    resources: plugin.resources.map(serializeResource),
    plugin_pins: plugin.plugin_pins.map((pluginPin) => ({
      ref: pluginPin.ref,
      version_constraint: pluginPin.version_constraint,
    })),
  };
  if (plugin.dependencies && plugin.dependencies.length > 0) {
    row.dependencies = plugin.dependencies.map((dependency) => ({
      dependency_name: dependency.dependency_name,
      version_constraint: dependency.version_constraint,
      order: dependency.order,
    }));
  }
  if (plugin.embedded_plugin_refs && plugin.embedded_plugin_refs.length > 0) {
    row.embedded_plugin_refs = [...plugin.embedded_plugin_refs];
  }
  if (plugin.claude) {
    row.claude = plugin.claude;
  }
  return row;
}

export function normalizePluginExportForToml(bundle: PluginExport): {
  plugins: PluginExportEntry[];
  embedded_plugins: MultiPluginExport["embedded_plugins"];
} {
  return {
    plugins: bundle.plugins.map((plugin) => ({
      ...plugin,
      plugin_pins: [...(plugin.plugin_pins ?? [])],
      resources: [...plugin.resources],
    })),
    embedded_plugins: bundle.embedded_plugins ?? [],
  };
}

export function pluginExportToTomlDocument(bundle: PluginExport): Record<string, unknown> {
  const normalized = normalizePluginExportForToml(bundle);
  const document: Record<string, unknown> = {
    schema: PLUGIN_SCHEMA,
    version: PLUGIN_SCHEMA_VERSION,
    plugins: normalized.plugins
      .map(serializePluginEntry)
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
  };
  if (normalized.embedded_plugins.length > 0) {
    document.embedded_plugins = embeddedPluginsToTomlRecord(
      normalized.embedded_plugins,
    );
  }
  return document;
}

export function pluginExportFromTomlDocument(
  document: Record<string, unknown>,
): MultiPluginExport {
  const pluginsRaw = document.plugins;
  if (!Array.isArray(pluginsRaw) || pluginsRaw.length === 0) {
    throw new Error("Plugin export must include at least one [[plugins]] entry");
  }

  return {
    $schema: PLUGIN_SCHEMA,
    version: PLUGIN_SCHEMA_VERSION,
    plugins: pluginsRaw.map(parsePluginEntry),
    embedded_plugins: embeddedPluginsFromTomlRecord(document.embedded_plugins),
  };
}

export function parsePluginExportToml(raw: string): MultiPluginExport {
  const document = parseTransportToml(raw, "plugin export");
  const { schema, version } = readSchemaHeader(document);
  if (schema !== PLUGIN_SCHEMA) {
    throw new Error(`Unsupported plugin schema: ${schema}`);
  }
  if (version !== PLUGIN_SCHEMA_VERSION) {
    throw new Error(`Unsupported plugin version: ${version}`);
  }
  return pluginExportFromTomlDocument(document);
}

export function formatPluginExportToml(bundle: PluginExport): string {
  const pluginNames = normalizePluginExportForToml(bundle).plugins.map(
    (plugin) => plugin.name,
  );
  const sourceMachine = process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? "unknown";
  const header = [
    "# HarnessTap plugin export",
    `# Plugins: ${pluginNames.join(", ")}`,
    `# Generated at: ${new Date().toISOString()}`,
    `# Source machine: ${sourceMachine}`,
    "",
  ].join("\n");
  return `${header}${formatTransportToml(pluginExportToTomlDocument(bundle))}`;
}
