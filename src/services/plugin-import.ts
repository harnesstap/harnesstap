import { resolve } from "node:path";
import {
  createPlugin,
  addResourceToPlugin,
  syncClaudeMarketplacePluginsAfterAdd,
  addDependencyToPlugin,
  getPlugin,
} from "../models/plugin-model.js";
import { attachPluginPinToPlugin } from "./plugin-composition.js";
import { isCompositionResourceType } from "./plugin-composition.js";
import {
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import type {
  PluginExportEntry,
  MultiPluginExport,
  Plugin,
  Resource,
} from "../types.js";
import { writeEmbeddedPluginsOnImport } from "./claude-plugin-export.js";
import { inspectPluginExportFile } from "./plugin-export.js";

export interface ImportPluginOptions {
  /** When importing a plugin export with `embedded_plugins`, write those trees under this directory. */
  embeddedTargetDir?: string;
  /** Override the imported plugin name (useful when installing a remote library under a different local name). */
  pluginNameOverride?: string;
  /** Override the resource source label recorded on imported resources. */
  resourceSource?: string;
  /** Skip exported plugins whose name/version key is not allowed. */
  includePlugins?: (plugin: PluginExportEntry) => boolean;
}

export interface ImportedPluginBundleEntry {
  plugin: Plugin;
  resources: Resource[];
}

export interface ImportedPluginBundle {
  plugin: Plugin;
  resources: Resource[];
  plugins: ImportedPluginBundleEntry[];
}

function importPluginFromBundleParsed(
  bundle: PluginExportEntry,
  embeddedPlugins: MultiPluginExport["embedded_plugins"],
  filePath: string,
  opts?: ImportPluginOptions,
): { plugin: Plugin; resources: Resource[] } {
  const claude = bundle.claude;

  const plugin = createPlugin({
    name: opts?.pluginNameOverride ?? bundle.name,
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
    addResourceToPlugin(plugin.id, upserted.resource.id);
    resources.push(upserted.resource);
  }

  const pluginId = plugin.id;
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
  const pluginEmbeddedPlugins = embeddedPlugins.filter((plugin) =>
    embeddedPluginKeys.has(`${plugin.ref}\u0000${plugin.version_constraint}`),
  );

  function syncPinsAfterMutation(ref: string, versionConstraint: string): void {
    const refreshed = getPlugin(pluginId);
    if (!refreshed) {
      throw new Error(`Plugin ${pluginId} not found during bundle import`);
    }
    syncClaudeMarketplacePluginsAfterAdd(refreshed, ref, versionConstraint);
  }

  for (const p of pluginPins) {
    attachPluginPinToPlugin(pluginId, p.ref, p.version_constraint, {
      embedOnExport: false,
    });
    syncPinsAfterMutation(p.ref, p.version_constraint);
  }

  const embeddedDir = opts?.embeddedTargetDir ?? resolve(process.cwd());
  if (pluginEmbeddedPlugins.length > 0) {
    writeEmbeddedPluginsOnImport(embeddedDir, pluginEmbeddedPlugins);
    for (const e of pluginEmbeddedPlugins) {
      attachPluginPinToPlugin(pluginId, e.ref, e.version_constraint, {
        embedOnExport: false,
      });
      syncPinsAfterMutation(e.ref, e.version_constraint);
    }
  }

  for (const dep of bundle.dependencies ?? []) {
    addDependencyToPlugin(plugin.id, dep.dependency_name, dep.version_constraint);
  }

  const finalized = getPlugin(plugin.id);
  if (!finalized) {
    throw new Error(`Plugin ${plugin.id} not found after bundle import`);
  }
  return { plugin: finalized, resources };
}

/**
 * Import a bundle from a file, creating the plugin and resources.
 */
export function importFromFile(
  filePath: string,
  opts?: ImportPluginOptions,
): ImportedPluginBundle {
  const normalized = inspectPluginExportFile(filePath);
  const bundlePlugins = normalized.plugins.filter((bundlePlugin) =>
    opts?.includePlugins ? opts.includePlugins(bundlePlugin) : true,
  );
  const plugins = bundlePlugins.map((bundlePlugin, index) =>
    importPluginFromBundleParsed(
      bundlePlugin,
      normalized.embedded_plugins,
      filePath,
      {
        ...opts,
        pluginNameOverride:
          index === 0 ? opts?.pluginNameOverride : undefined,
      },
    ),
  );
  const [firstPlugin] = plugins;
  if (!firstPlugin) {
    throw new Error(`Bundle contains no plugins: ${filePath}`);
  }

  return {
    plugin: firstPlugin.plugin,
    resources: firstPlugin.resources,
    plugins,
  };
}
