import { listLayers } from "../models/layer-model.js";
import type { Layer } from "../types.js";

export const PROFILE_LAYER_TAG = "profile";

/** Reserved virtual profile that clears managed global harness files. */
export const EMPTY_PROFILE_NAME = "empty";

/** Sentinel id for the virtual empty profile (not a DB layer row). */
export const EMPTY_PROFILE_LAYER_ID = "builtin:empty";

export const EMPTY_PROFILE_DESCRIPTION = "No resources";

export function isEmptyBuiltinProfile(name: string): boolean {
  return name.trim() === EMPTY_PROFILE_NAME;
}

/** Synthetic layer payload for list/show UIs — not persisted. */
export function getEmptyBuiltinProfileLayer(): Layer {
  return {
    id: EMPTY_PROFILE_LAYER_ID,
    name: EMPTY_PROFILE_NAME,
    version: "",
    org_slug: "",
    catalog_slug: "",
    description: EMPTY_PROFILE_DESCRIPTION,
    tags: [PROFILE_LAYER_TAG],
    created_at: "",
    updated_at: "",
  };
}

export function isProfileLayer(layer: Pick<Layer, "tags">): boolean {
  return layer.tags.includes(PROFILE_LAYER_TAG);
}

export function listProfileLayers(): Layer[] {
  return listLayers().filter((layer) => isProfileLayer(layer));
}
