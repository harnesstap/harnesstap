import { listLayers } from "../models/layer-model.js";
import type { Layer } from "../types.js";

export const PROFILE_LAYER_TAG = "profile";

export function isProfileLayer(layer: Pick<Layer, "tags">): boolean {
  return layer.tags.includes(PROFILE_LAYER_TAG);
}

export function listProfileLayers(): Layer[] {
  return listLayers().filter((layer) => isProfileLayer(layer));
}
