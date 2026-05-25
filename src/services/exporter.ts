import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
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
  ExportBundlePresetPluginPin,
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

/**
 * Export a preset and its resources as a portable JSON bundle.
 */
export function exportPreset(
  presetNameOrId: string,
  exportOpts?: ExportPresetOptions,
): ExportBundle {
  const preset = getPreset(presetNameOrId);
  if (!preset) throw new Error(`Preset not found: ${presetNameOrId}`);

  const resources = getPresetResources(preset.id);
  const presetRows = listPresetPlugins(preset.id);
  const deps = listPresetDependencies(preset.id);
  const { pins, embeddedRoots } = classifyPresetPluginsForExport(
    presetRows,
    exportOpts,
  );

  const presetSubset = {
    name: preset.name,
    version: preset.version,
    description: preset.description,
    tags: preset.tags,
    ...(preset.claude ? { claude: preset.claude } : {}),
  };

  const bundle: ExportBundle = {
    $schema: BUNDLE_SCHEMA,
    version: BUNDLE_VERSION,
    preset: presetSubset,
    ...(preset.claude ? { claude: preset.claude } : {}),
    resources: resources.map((r) => ({
      type: r.type,
      name: r.name,
      description: r.description,
      content: r.content,
      metadata: r.metadata,
    })),
    plugins: pins,
    embedded_plugins: embeddedRoots,
    ...(deps.length > 0
      ? {
          dependencies: deps.map((d) => ({
            dependency_name: d.dependency_name,
            version_constraint: d.version_constraint,
            order: d.order,
          })),
        }
      : {}),
  };

  return bundle;
}

/**
 * Write a bundle to a file.
 */
export function exportToFile(
  presetNameOrId: string,
  filePath: string,
  exportOpts?: ExportPresetOptions,
): void {
  const bundle = exportPreset(presetNameOrId, exportOpts);
  writeFileSync(filePath, JSON.stringify(bundle, null, 2), "utf-8");
}

function importPresetFromBundleParsed(
  bundle: ExportBundle,
  filePath: string,
  opts?: ImportPresetOptions,
): { preset: Preset; resources: Resource[] } {
  const claude = bundle.claude ?? bundle.preset.claude;

  const preset = createPreset({
    name: bundle.preset.name,
    version: bundle.preset.version,
    description: bundle.preset.description,
    tags: bundle.preset.tags,
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
      source: `import:${filePath}`,
    });
    addResourceToPreset(preset.id, resource.id);
    resources.push(resource);
  }

  const presetId = preset.id;
  const pluginPins = bundle.plugins ?? [];
  const embeddedPlugins = bundle.embedded_plugins ?? [];

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
  if (embeddedPlugins.length > 0) {
    writeEmbeddedPluginsOnImport(embeddedDir, embeddedPlugins);
    for (const e of embeddedPlugins) {
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
): { preset: Preset; resources: Resource[] } {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as ExportBundle;

  if (parsed.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${parsed.version}`);
  }

  return importPresetFromBundleParsed(parsed, filePath, opts);
}
