import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getEnvironment } from "../../models/environment.js";
import {
  getPlugin,
  getPluginById,
  getPluginResources,
  listPluginDependencies,
  resolvePluginSelector,
} from "../../models/plugin-model.js";
import { listAttachedPluginPins } from "../../services/plugin-composition.js";
import { renderPluginShow } from "../../services/plugin-show-render.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export function handlePluginShowCommand(
  name: string,
  opts: { format?: string; showId?: boolean },
  profileExtras?: { active: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const plugin = getPlugin(name);
  if (!plugin) {
    ui.danger(`Plugin not found: ${name}`);
    return;
  }
  const allResources = getPluginResources(plugin.id);
  const resources = allResources.filter(
    (resource) => resource.type !== "plugin",
  );
  const pluginPins = listAttachedPluginPins(plugin.id);
  const pluginPinRows = pluginPins.map((pin, index) => ({
    plugin_id: plugin.id,
    ref: pin.ref,
    version_constraint: pin.version_constraint,
    order: index,
    embed_on_export: pin.embed_on_export,
  }));
  const dependencies = listPluginDependencies(plugin.id);
  const configuredPlugin = (() => {
    if (/^[0-9A-Z]{26}$/.test(name)) {
      return getPluginById(name);
    }
    const atIdx = name.lastIndexOf("@");
    if (atIdx > 0) {
      return resolvePluginSelector(name);
    }
    return resolvePluginSelector(`${plugin.name}@${plugin.version}`);
  })();
  const configuredPluginDefaultEnvironment = configuredPlugin?.default_environment_id
    ? getEnvironment(configuredPlugin.default_environment_id)
    : undefined;

  if (format === "json") {
    printJson({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      dirty: plugin.dirty,
      description: plugin.description,
      tags: plugin.tags,
      ...(plugin.claude ? { claude: plugin.claude } : {}),
      created_at: plugin.created_at,
      updated_at: plugin.updated_at,
      resources,
      plugin_pins: pluginPinRows,
      dependencies,
      ...(configuredPlugin
        ? {
            configured_plugin: {
              id: configuredPlugin.id,
              name: configuredPlugin.name,
              version: configuredPlugin.version,
              default_environment: configuredPluginDefaultEnvironment?.name
                ?? configuredPlugin.default_environment_id
                ?? null,
            },
          }
        : {}),
      ...(profileExtras ? { active: profileExtras.active } : {}),
    });
    return;
  }

  console.log(renderPluginShow(plugin, name, {
    showId: opts.showId,
    profileExtras,
  }));
}
