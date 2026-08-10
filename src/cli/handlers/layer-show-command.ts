import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getEnvironment } from "../../models/environment.js";
import {
  getLayer,
  getLayerById,
  getLayerResources,
  listLayerDependencies,
  resolveLayerSelector,
} from "../../models/layer-model.js";
import { listAttachedPluginPins } from "../../services/layer-composition.js";
import { renderLayerShow } from "../../services/layer-show-render.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export function handleLayerShowCommand(
  name: string,
  opts: { format?: string; showId?: boolean },
  profileExtras?: { active: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const layer = getLayer(name);
  if (!layer) {
    ui.danger(`Layer not found: ${name}`);
    return;
  }
  const allResources = getLayerResources(layer.id);
  const resources = allResources.filter(
    (resource) => resource.type !== "plugin",
  );
  const pluginPins = listAttachedPluginPins(layer.id);
  const pluginPinRows = pluginPins.map((pin, index) => ({
    layer_id: layer.id,
    ref: pin.ref,
    version_constraint: pin.version_constraint,
    order: index,
    embed_on_export: pin.embed_on_export,
  }));
  const dependencies = listLayerDependencies(layer.id);
  const configuredLayer = (() => {
    if (/^[0-9A-Z]{26}$/.test(name)) {
      return getLayerById(name);
    }
    const atIdx = name.lastIndexOf("@");
    if (atIdx > 0) {
      return resolveLayerSelector(name);
    }
    return resolveLayerSelector(`${layer.name}@${layer.version}`);
  })();
  const configuredLayerDefaultEnvironment = configuredLayer?.default_environment_id
    ? getEnvironment(configuredLayer.default_environment_id)
    : undefined;

  if (format === "json") {
    printJson({
      id: layer.id,
      name: layer.name,
      version: layer.version,
      dirty: layer.dirty,
      description: layer.description,
      tags: layer.tags,
      ...(layer.claude ? { claude: layer.claude } : {}),
      created_at: layer.created_at,
      updated_at: layer.updated_at,
      resources,
      plugin_pins: pluginPinRows,
      dependencies,
      ...(configuredLayer
        ? {
            configured_layer: {
              id: configuredLayer.id,
              name: configuredLayer.name,
              version: configuredLayer.version,
              default_environment: configuredLayerDefaultEnvironment?.name
                ?? configuredLayer.default_environment_id
                ?? null,
            },
          }
        : {}),
      ...(profileExtras ? { active: profileExtras.active } : {}),
    });
    return;
  }

  console.log(renderLayerShow(layer, name, {
    showId: opts.showId,
    profileExtras,
  }));
}
