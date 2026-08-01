import { listLayers } from "../models/layer-model.js";
import type { Layer } from "../types.js";

export const PROFILE_LAYER_TAG = "profile";

/** Internal snapshot key for a cleared global apply (not a user-facing profile). */
export const CLEARED_GLOBAL_PROFILE_NAME = "empty";

/** @deprecated Use CLEARED_GLOBAL_PROFILE_NAME. Reserved legacy name — not a selectable profile. */
export const EMPTY_PROFILE_NAME = CLEARED_GLOBAL_PROFILE_NAME;

/** Sentinel id for cleared global apply snapshots (not a DB layer row). */
export const CLEARED_GLOBAL_PROFILE_LAYER_ID = "builtin:empty";

/** @deprecated Use CLEARED_GLOBAL_PROFILE_LAYER_ID. */
export const EMPTY_PROFILE_LAYER_ID = CLEARED_GLOBAL_PROFILE_LAYER_ID;

export function isEmptyBuiltinProfile(name: string): boolean {
  return name.trim() === CLEARED_GLOBAL_PROFILE_NAME;
}

export function isReservedProfileName(name: string): boolean {
  return isEmptyBuiltinProfile(name);
}

export function isProfileLayer(layer: Pick<Layer, "tags">): boolean {
  return layer.tags.includes(PROFILE_LAYER_TAG);
}

export function listProfileLayers(): Layer[] {
  return listLayers().filter((layer) => isProfileLayer(layer));
}
