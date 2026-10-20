import { listPluginExcludes } from "../../services/plugin-extends.js";
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
import {
  findLocalPluginBySelector,
  LocalPluginSelectorError,
} from "../../services/profile-use-target.js";
import { trackPluginUsed } from "../../telemetry/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { CLI_ERRORS, CLI_HINTS } from "../messages.js";
import { fail } from "../shared.js";

export function handlePluginShowCommand(
  name: string,
  opts: { format?: string; showId?: boolean },
  profileExtras?: { active: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  let plugin: ReturnType<typeof getPlugin>;
  try {
    plugin = getPlugin(name) ?? findLocalPluginBySelector(name, { command: "ht plugin show" });
  } catch (error) {
    if (error instanceof LocalPluginSelectorError) {
      fail(error.message, { hints: error.hints });
      return;
    }
    throw error;
  }
  if (!plugin) {
    fail(CLI_ERRORS.pluginNotFound(name), { hint: CLI_HINTS.pluginList });
    return;
  }
  const exactMatch = plugin.name === name || plugin.id === name || name.startsWith(`${plugin.name}@`);
  trackPluginUsed({
    pluginSlug: plugin.name,
  });
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
    // A slug, catalog ref, or display name already resolved to one version.
    if (!exactMatch) return plugin;
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
      ...(plugin.upstream ? { upstream: plugin.upstream } : {}),
      ...(plugin.upstream?.kind === "extends" ? { excludes: listPluginExcludes(plugin.id) } : {}),
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

  console.log(renderPluginShow(plugin, exactMatch ? name : plugin.id, {
    showId: opts.showId,
    profileExtras,
  }));
}
