import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import {
  getPreset,
  getPresetResources,
  createPreset,
  addResourceToPreset,
  syncClaudePresetPluginsAfterAdd,
  listPresetDependencies,
  addDependencyToPreset,
} from "../models/preset.js";
import { listPresetPlugins, addPluginToPreset } from "../models/plugin.js";
import type { PresetPluginRow } from "../models/plugin.js";
import { createResource } from "../models/resource.js";
import { loadInstalled } from "../plugins/claude-installed.js";
import type {
  ExportBundle,
  ExportBundleDependency,
  ExportBundlePreset,
  ExportBundlePresetEntry,
  ExportBundlePresetPluginPin,
  LegacyExportBundle,
  MultiPresetExportBundle,
  Preset,
  Resource,
} from "../types.js";
import { BUNDLE_SCHEMA, BUNDLE_VERSION } from "../types.js";
import { collectEmbeddedPluginFiles, writeEmbeddedPluginsOnImport } from "./plugin-bundle.js";

export interface ExportPresetOptions {
  /** When true, embed marketplace-installed plugins too if their install paths resolve from `HOME`. */
  embedPlugins?: boolean;
  projectRoot?: string;
  /** Defaults to `$HOME`; used only to locate installed Claude marketplace plugins when embedding them. */
  homeRoot?: string;
}

export interface ImportPresetOptions {
  /** When importing a bundle with `embedded_plugins`, write those trees under this directory. */
  embeddedTargetDir?: string;
  /** Override the imported preset name (useful when installing a remote library under a different local name). */
  presetNameOverride?: string;
  /** Override the resource source label recorded on imported resources. */
  resourceSource?: string;
  /** Skip bundle presets whose name/version key is not allowed. */
  includePresets?: (preset: ExportBundlePresetEntry) => boolean;
}

export interface ImportedPresetBundleEntry {
  preset: Preset;
  resources: Resource[];
}

export interface ImportedPresetBundle {
  preset: Preset;
  resources: Resource[];
  presets: ImportedPresetBundleEntry[];
}

type ExportPresetSelector = string | string[];

interface NormalizedExportBundle {
  embedded_plugins: LegacyExportBundle["embedded_plugins"];
  presets: ExportBundlePresetEntry[];
  multiPreset: boolean;
}

interface ExportBundlePayloadWithEmbedded extends ExportBundlePresetEntry {
  embedded_plugins: LegacyExportBundle["embedded_plugins"];
}

interface ParsedBundleSummary {
  presets: ExportBundlePresetEntry[];
  embedded_plugins: LegacyExportBundle["embedded_plugins"];
  multiPreset: boolean;
}

function resolveHomeRoot(opts?: ExportPresetOptions): string {
  if (opts?.homeRoot && opts.homeRoot.length > 0) return opts.homeRoot;
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function resolveProjectRoot(opts?: ExportPresetOptions): string {
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

function classifyPresetPluginsForExport(
  rows: PresetPluginRow[],
  opts?: ExportPresetOptions,
): {
  pins: ExportBundlePresetPluginPin[];
  embeddedRoots: ExportBundle["embedded_plugins"];
} {
  const projectRoot = resolveProjectRoot(opts);
  const homeRoot = resolveHomeRoot(opts);
  const optEmbedMarketplace = opts?.embedPlugins ?? false;
  const pins: ExportBundlePresetPluginPin[] = [];
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

function toExportBundlePreset(preset: Preset): ExportBundlePreset {
  return {
    name: preset.name,
    version: preset.version,
    description: preset.description,
    tags: preset.tags,
    ...(preset.claude ? { claude: preset.claude } : {}),
  };
}

function collectBundlePayload(
  preset: Preset,
  exportOpts?: ExportPresetOptions,
): ExportBundlePayloadWithEmbedded {
  const resources = getPresetResources(preset.id);
  const presetRows = listPresetPlugins(preset.id);
  const deps = listPresetDependencies(preset.id);
  const { pins, embeddedRoots } = classifyPresetPluginsForExport(
    presetRows,
    exportOpts,
  );

  const payload: ExportBundlePayloadWithEmbedded = {
    name: preset.name,
    version: preset.version,
    description: preset.description,
    tags: preset.tags,
    ...(preset.claude ? { claude: preset.claude } : {}),
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
  if ("presets" in bundle) {
    return {
      embedded_plugins: bundle.embedded_plugins ?? [],
      presets: bundle.presets.map((preset) => ({
        ...preset,
        plugins: [...(preset.plugins ?? [])],
      })),
      multiPreset: true,
    };
  }

  const { embedded_plugins, ...presetPayload } = bundle;
  return {
    embedded_plugins: embedded_plugins ?? [],
      presets: [
        {
          ...presetPayload.preset,
          plugins: [...(presetPayload.plugins ?? [])],
          resources: presetPayload.resources,
          ...(presetPayload.claude ? { claude: presetPayload.claude } : {}),
          ...(presetPayload.dependencies ? { dependencies: presetPayload.dependencies } : {}),
        },
      ],
      multiPreset: false,
  };
}

function parseBundle(raw: string): ParsedBundleSummary {
  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as ExportBundle;

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

  return normalizeExportBundle(parsed);
}

export function inspectBundleFile(filePath: string): ParsedBundleSummary {
  return parseBundle(readFileSync(filePath, "utf-8"));
}

function formatBundleAsJsonc(bundle: ExportBundle): string {
  const presetNames = "presets" in bundle
    ? bundle.presets.map((preset) => preset.name)
    : [bundle.preset.name];
  const sourceMachine = process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? "unknown";

  return [
    "/*",
    " * HarnessDeck preset bundle",
    ` * Presets: ${presetNames.join(", ")}`,
    ` * Generated at: ${new Date().toISOString()}`,
    ` * Source machine: ${sourceMachine}`,
    " */",
    JSON.stringify(bundle, null, 2),
  ].join("\n");
}

/**
 * Export a preset and its resources as a portable JSON bundle.
 */
export function exportPreset(
  presetNameOrId: ExportPresetSelector,
  exportOpts?: ExportPresetOptions,
): ExportBundle {
  const selectors = Array.isArray(presetNameOrId) ? presetNameOrId : [presetNameOrId];
  const presets = selectors.map((selector) => {
    const preset = getPreset(selector);
    if (!preset) throw new Error(`Preset not found: ${selector}`);
    return preset;
  });
  const payloads = presets.map((preset) => collectBundlePayload(preset, exportOpts));

  if (payloads.length === 1) {
    const [payload] = payloads;
    if (!payload) {
      throw new Error("Expected a bundle payload for export");
    }
    return {
      $schema: BUNDLE_SCHEMA,
      version: BUNDLE_VERSION,
      preset: toExportBundlePreset({
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
    presets: payloads.map(({ embedded_plugins: _embeddedPlugins, ...payload }) => ({
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
  } satisfies MultiPresetExportBundle;
}

/**
 * Write a bundle to a file.
 */
export function exportToFile(
  presetNameOrId: ExportPresetSelector,
  filePath: string,
  exportOpts?: ExportPresetOptions,
): void {
  const bundle = exportPreset(presetNameOrId, exportOpts);
  const content = extname(filePath).toLowerCase() === ".jsonc"
    ? formatBundleAsJsonc(bundle)
    : JSON.stringify(bundle, null, 2);
  writeFileSync(filePath, content, "utf-8");
}

function importPresetFromBundleParsed(
  bundle: ExportBundlePresetEntry,
  embeddedPlugins: LegacyExportBundle["embedded_plugins"],
  useLegacyEmbeddedFallback: boolean,
  filePath: string,
  opts?: ImportPresetOptions,
): { preset: Preset; resources: Resource[] } {
  const claude = bundle.claude;

  const preset = createPreset({
    name: opts?.presetNameOverride ?? bundle.name,
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
    addResourceToPreset(preset.id, resource.id);
    resources.push(resource);
  }

  const presetId = preset.id;
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
  const presetEmbeddedPlugins = embeddedPlugins.filter((plugin) =>
    embeddedPluginKeys.has(`${plugin.ref}\u0000${plugin.version_constraint}`),
  );

  function syncPinsAfterMutation(ref: string, versionConstraint: string): void {
    const refreshed = getPreset(presetId);
    if (!refreshed) {
      throw new Error(`Preset ${presetId} not found during bundle import`);
    }
    syncClaudePresetPluginsAfterAdd(refreshed, ref, versionConstraint);
  }

  for (const p of pluginPins) {
    addPluginToPreset(presetId, p.ref, p.version_constraint, {
      embedOnExport: false,
    });
    syncPinsAfterMutation(p.ref, p.version_constraint);
  }

  const embeddedDir = opts?.embeddedTargetDir ?? resolve(process.cwd());
  if (presetEmbeddedPlugins.length > 0) {
    writeEmbeddedPluginsOnImport(embeddedDir, presetEmbeddedPlugins);
    for (const e of presetEmbeddedPlugins) {
      addPluginToPreset(presetId, e.ref, e.version_constraint, {
        /** Pin only; inlined trees live in `embedded_plugins` on the bundle, not persisted as “always embed”. */
        embedOnExport: false,
      });
      syncPinsAfterMutation(e.ref, e.version_constraint);
    }
  }

  for (const dep of bundle.dependencies ?? []) {
    addDependencyToPreset(preset.id, dep.dependency_name, dep.version_constraint);
  }

  const finalized = getPreset(preset.id);
  if (!finalized) {
    throw new Error(`Preset ${preset.id} not found after bundle import`);
  }
  return { preset: finalized, resources };
}

/**
 * Import a bundle from a file, creating the preset and resources.
 */
export function importFromFile(
  filePath: string,
  opts?: ImportPresetOptions,
) : ImportedPresetBundle {
  const normalized = inspectBundleFile(filePath);
  const bundlePresets = normalized.presets.filter((bundlePreset) =>
    opts?.includePresets ? opts.includePresets(bundlePreset) : true,
  );
  const presets = bundlePresets.map((bundlePreset, index) =>
    importPresetFromBundleParsed(
      bundlePreset,
      normalized.embedded_plugins,
      !normalized.multiPreset,
      filePath,
      {
        ...opts,
        presetNameOverride:
          index === 0 ? opts?.presetNameOverride : undefined,
      },
    ),
  );
  const [firstPreset] = presets;
  if (!firstPreset) {
    throw new Error(`Bundle contains no presets: ${filePath}`);
  }

  return {
    preset: firstPreset.preset,
    resources: firstPreset.resources,
    presets,
  };
}
