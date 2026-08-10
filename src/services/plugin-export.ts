import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  getPlugin,
  getPluginResources,
  listPluginDependencies,
} from "../models/plugin-model.js";
import { listDependencies } from "./plugin-dependency.js";
import { isCompositionResourceType } from "./plugin-composition.js";
import type { DependencyView } from "./plugin-dependency.js";
import { loadInstalled } from "../plugins/claude-installed.js";
import type {
  DeckJson,
  DeckJsonEnvironment,
  DeckJsonExportOptions,
  DeckJsonPlugin,
  EnvVarMetadata,
  PluginExportDependency,
  PluginExportEntry,
  PluginExportPluginPin,
  PluginExportResource,
  Plugin,
  MultiPluginExport,
} from "../types.js";
import {
  PLUGIN_SCHEMA,
  PLUGIN_SCHEMA_VERSION,
  DECK_JSON_VERSION,
  DECK_SCHEMA,
} from "../types.js";
import {
  CONTEXT_SIDE_RESOURCE_TYPES,
  ENVIRONMENT_RESOURCE_TYPES,
} from "./resource-classification.js";
import { collectEmbeddedPluginFiles } from "./claude-plugin-export.js";
import {
  assertTransportExtension,
  formatPluginExportToml,
  parsePluginExportToml,
  readTransportFile,
} from "./transport/index.js";
import { assertPluginsCleanForShare } from "./plugin-versioning.js";

export interface ExportPluginOptions {
  /** When true, embed marketplace-installed plugins too if their install paths resolve from `HOME`. */
  embedPlugins?: boolean;
  projectRoot?: string;
  /** Defaults to `$HOME`; used only to locate installed Claude marketplace plugins when embedding them. */
  homeRoot?: string;
}

export interface ParsedPluginExportSummary {
  plugins: PluginExportEntry[];
  embedded_plugins: MultiPluginExport["embedded_plugins"];
  multiPlugin: boolean;
}

type ExportPluginSelector = string | string[];

interface NormalizedPluginExport {
  embedded_plugins: MultiPluginExport["embedded_plugins"];
  plugins: PluginExportEntry[];
  multiPlugin: boolean;
}

interface PluginExportPayloadWithEmbedded extends PluginExportEntry {
  embedded_plugins: MultiPluginExport["embedded_plugins"];
}

function resolveHomeRoot(opts?: ExportPluginOptions): string {
  if (opts?.homeRoot && opts.homeRoot.length > 0) return opts.homeRoot;
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function resolveProjectRoot(opts?: ExportPluginOptions): string {
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

function classifyDependenciesForExport(
  rows: DependencyView[],
  opts?: ExportPluginOptions,
): {
  pins: PluginExportPluginPin[];
  embeddedRoots: MultiPluginExport["embedded_plugins"];
} {
  const projectRoot = resolveProjectRoot(opts);
  const homeRoot = resolveHomeRoot(opts);
  const optEmbedMarketplace = opts?.embedPlugins ?? false;
  const pins: PluginExportPluginPin[] = [];
  const embeddedRoots: MultiPluginExport["embedded_plugins"] = [];

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
  plugin: Plugin,
  exportOpts?: ExportPluginOptions,
): PluginExportPayloadWithEmbedded {
  const resources = getPluginResources(plugin.id);
  const pluginRows = listDependencies(plugin.id);
  const deps = listPluginDependencies(plugin.id);
  const { pins, embeddedRoots } = classifyDependenciesForExport(
    pluginRows,
    exportOpts,
  );

  const payload: PluginExportPayloadWithEmbedded = {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    tags: plugin.tags,
    ...(plugin.claude ? { claude: plugin.claude } : {}),
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
          } satisfies PluginExportDependency)),
        }
      : {}),
  };

  return payload;
}

function normalizePluginExport(bundle: MultiPluginExport): NormalizedPluginExport {
  return {
    embedded_plugins: bundle.embedded_plugins ?? [],
    plugins: bundle.plugins.map((plugin) => ({
      ...plugin,
      plugin_pins: [...(plugin.plugin_pins ?? [])],
    })),
    multiPlugin: bundle.plugins.length > 1,
  };
}

function parsePluginExport(raw: string): ParsedPluginExportSummary {
  const multi = parsePluginExportToml(raw);
  return {
    plugins: multi.plugins.map((plugin) => ({
      ...plugin,
      plugin_pins: [...(plugin.plugin_pins ?? [])],
    })),
    embedded_plugins: multi.embedded_plugins ?? [],
    multiPlugin: multi.plugins.length > 1,
  };
}

export function inspectPluginExportFile(filePath: string): ParsedPluginExportSummary {
  return parsePluginExport(readTransportFile(filePath));
}

function isEnvironmentResourceType(type: string): boolean {
  return (ENVIRONMENT_RESOURCE_TYPES as readonly string[]).includes(type);
}

function isContextSideResourceType(type: string): boolean {
  return (CONTEXT_SIDE_RESOURCE_TYPES as readonly string[]).includes(type);
}

function splitPluginExportResources(resources: PluginExportResource[]): {
  pluginResources: PluginExportResource[];
  environmentResources: PluginExportResource[];
} {
  const pluginResources: PluginExportResource[] = [];
  const environmentResources: PluginExportResource[] = [];

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
  resources: PluginExportResource[],
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

function defaultEnvironmentNameForPlugin(pluginName: string): string {
  return `${pluginName}-env`;
}

function pluginToDeckJsonEntry(
  plugin: Plugin,
  pluginEnvironment: string | undefined,
): DeckJsonPlugin {
  return {
    name: plugin.name,
    version: plugin.version,
    ...(plugin.org_slug ? { org: plugin.org_slug } : {}),
    ...(plugin.catalog_slug ? { catalog: plugin.catalog_slug } : {}),
    ...(pluginEnvironment ? { environment: pluginEnvironment } : {}),
  };
}

export function parsedPluginExportToDeckJson(
  normalized: ParsedPluginExportSummary,
  options?: DeckJsonExportOptions,
): DeckJson {
  const environmentsByName = new Map<string, DeckJsonEnvironment>();
  const deckPlugins: DeckJsonPlugin[] = [];

  for (const plugin of normalized.plugins) {
    const version =
      typeof plugin.version === "string" && plugin.version.length > 0
        ? plugin.version
        : "1.0.0";
    const { environmentResources } = splitPluginExportResources(plugin.resources);
    const envName = defaultEnvironmentNameForPlugin(plugin.name);
    const envEntry = environmentResourcesToDeckJson(
      envName,
      environmentResources,
    );
    let pluginEnvironment: string | undefined;
    if (envEntry) {
      environmentsByName.set(envEntry.name, envEntry);
      pluginEnvironment = envEntry.name;
    }

    deckPlugins.push(
      pluginToDeckJsonEntry(
        {
          id: "",
          name: plugin.name,
          version,
          org_slug: "",
          catalog_slug: "",
          origin: "authored",
          description: plugin.description ?? "",
          tags: plugin.tags ?? [],
          dirty: false,
          created_at: "",
          updated_at: "",
        },
        pluginEnvironment,
      ),
    );
  }

  const [firstPlugin] = normalized.plugins;
  const deckName =
    options?.deckName ?? firstPlugin?.name ?? "imported-deck";

  return {
    $schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: deckName,
    plugins: deckPlugins,
    environments: [...environmentsByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}

/**
 * Convert a plugin v1 export into canonical deck.json (plugins + configured plugins).
 */
export function pluginExportToDeckJson(
  bundle: MultiPluginExport,
  options?: DeckJsonExportOptions,
): DeckJson {
  return parsedPluginExportToDeckJson(normalizePluginExport(bundle), options);
}

function buildMultiPluginExport(
  payloads: PluginExportPayloadWithEmbedded[],
): MultiPluginExport {
  const embeddedPluginsByKey = new Map<
    string,
    MultiPluginExport["embedded_plugins"][number]
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
    $schema: PLUGIN_SCHEMA,
    version: PLUGIN_SCHEMA_VERSION,
    plugins: payloads.map(({ embedded_plugins: embeddedPlugins, ...payload }) => ({
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
 * Export a plugin and its resources as a portable TOML bundle.
 */
export function exportPlugin(
  pluginNameOrId: ExportPluginSelector,
  exportOpts?: ExportPluginOptions,
): MultiPluginExport {
  process.stderr.write(
    "Warning: exportPlugin writes plugin v1 (urn:harnesstap:plugin:v1). Prefer migrate export --plugin for sharing.\n",
  );
  const selectors = Array.isArray(pluginNameOrId) ? pluginNameOrId : [pluginNameOrId];
  const plugins = selectors.map((selector) => {
    const plugin = getPlugin(selector);
    if (!plugin) throw new Error(`Plugin not found: ${selector}`);
    return plugin;
  });
  assertPluginsCleanForShare(plugins);
  const payloads = plugins.map((plugin) => collectBundlePayload(plugin, exportOpts));
  return buildMultiPluginExport(payloads);
}

/**
 * Write a bundle to a file.
 */
export function exportToFile(
  pluginNameOrId: ExportPluginSelector,
  filePath: string,
  exportOpts?: ExportPluginOptions,
): void {
  assertTransportExtension(filePath);
  const bundle = exportPlugin(pluginNameOrId, exportOpts);
  writeFileSync(filePath, formatPluginExportToml(bundle), "utf-8");
}
