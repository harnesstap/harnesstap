import { addResourceToPlugin, removeResourceFromPlugin } from "./plugin-component.js";
import {
  ensurePluginResource,
  listAttachedPluginPins,
} from "../services/composition-resource.js";

export interface LayerPluginRow {
  layer_id: string;
  ref: string;
  version_constraint: string;
  order: number;
  embed_on_export: boolean;
}

export function addPluginToLayer(
  layerId: string,
  ref: string,
  versionConstraint: string,
  opts?: { embedOnExport?: boolean; order?: number },
): void {
  const selector = ref.includes(":") ? ref : `plugin_pin:${ref}`;
  const constraint =
    versionConstraint === "latest" || versionConstraint === "*"
      ? undefined
      : versionConstraint;
  const resource = ensurePluginResource(selector, {
    versionConstraint: constraint,
    portable: opts?.embedOnExport ? "embed" : "reference",
  });
  addResourceToPlugin(layerId, resource.id);
}

export function removePluginFromLayer(layerId: string, ref: string): void {
  const pin = listAttachedPluginPins(layerId).find((entry) => entry.ref === ref);
  if (!pin) return;
  removeResourceFromPlugin(layerId, pin.resource.id);
}

export function listLayerPlugins(layerId: string): LayerPluginRow[] {
  return listAttachedPluginPins(layerId).map((pin, index) => ({
    layer_id: layerId,
    ref: pin.ref,
    version_constraint: pin.version_constraint,
    order: index,
    embed_on_export: pin.embed_on_export,
  }));
}
