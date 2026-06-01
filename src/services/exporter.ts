import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import {
  getLayer,
  getLayerResources,
  createLayer,
  addResourceToLayer,
  syncClaudeLayerPluginsAfterAdd,
  listLayerDependencies,
  addDependencyToLayer,
} from "../models/layer.js";
import { listLayerPlugins, addPluginToLayer } from "../models/plugin.js";
import type { LayerPluginRow } from "../models/plugin.js";
import { createResource } from "../models/resource.js";
import { loadInstalled } from "../plugins/claude-installed.js";
import type {
  ExportBundle,
  ExportBundleDependency,
  ExportBundleLayer,
  ExportBundleLayerEntry,
  ExportBundleLayerPluginPin,
  LegacyExportBundle,
  MultiLayerExportBundle,
  Layer,
  Resource,
} from "../types.js";
import { BUNDLE_SCHEMA, BUNDLE_VERSION } from "../types.js";
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
  const resources = getLayerResources(layer.id);
  const layerRows = listLayerPlugins(layer.id);
  const deps = listLayerDependencies(layer.id);
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
    resources: resources.map((r) => ({
      type: r.type,
      name: r.name,
      description: r.description,
      content: r.content,
      metadata: r.metadata,
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

  return normalizeExportBundle(parsed as ExportBundle);
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
export function exportLayer(
  layerNameOrId: ExportLayerSelector,
  exportOpts?: ExportLayerOptions,
): ExportBundle {
  const selectors = Array.isArray(layerNameOrId) ? layerNameOrId : [layerNameOrId];
  const layers = selectors.map((selector) => {
    const layer = getLayer(selector);
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

  const layer = createLayer({
    name: opts?.layerNameOverride ?? bundle.name,
    version: bundle.version,
    description: bundle.description,
    tags: bundle.tags,
    ...(claude ? { claude } : {}),
  });

  const resources: Resource[] = [];
  for (const r of bundle.resources) {
    const resource = createResource({
      type: r.type,
      name: r.name,
      description: r.description,
      content: r.content,
      metadata: r.metadata,
      source: opts?.resourceSource ?? `import:${filePath}`,
    });
    addResourceToLayer(layer.id, resource.id);
    resources.push(resource);
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
    const refreshed = getLayer(layerId);
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
