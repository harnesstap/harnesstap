import { listPlugins } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";

export const PROFILE_PLUGIN_TAG = "profile";

/** Home-scoped profile seeded from `ht init` / first-run home scan. */
export const GLOBAL_DEFAULT_PROFILE_NAME = "global default";

/** Pre-rename init profile name; migrated to GLOBAL_DEFAULT_PROFILE_NAME. */
export const LEGACY_DEFAULT_PROFILE_NAME = "default";

/** Project-scoped profile seeded when desktop adds a repository. */
export const PROJECT_DEFAULT_PROFILE_NAME = "project default";

/** Extra tag on auto-seeded project profiles; omitted from the Global rail. */
export const PROJECT_PROFILE_TAG = "project";

/** @deprecated Use PROFILE_PLUGIN_TAG */
export const PROFILE_LAYER_TAG = PROFILE_PLUGIN_TAG;

/** Internal snapshot key for a cleared global apply (not a user-facing profile). */
export const CLEARED_GLOBAL_PROFILE_NAME = "empty";

/** @deprecated Use CLEARED_GLOBAL_PROFILE_NAME. Reserved legacy name — not a selectable profile. */
export const EMPTY_PROFILE_NAME = CLEARED_GLOBAL_PROFILE_NAME;

/** Sentinel id for cleared global apply snapshots (not a DB plugin row). */
export const CLEARED_GLOBAL_PROFILE_PLUGIN_ID = "builtin:empty";

/** @deprecated Use CLEARED_GLOBAL_PROFILE_PLUGIN_ID */
export const CLEARED_GLOBAL_PROFILE_LAYER_ID = CLEARED_GLOBAL_PROFILE_PLUGIN_ID;

/** @deprecated Use CLEARED_GLOBAL_PROFILE_PLUGIN_ID. */
export const EMPTY_PROFILE_LAYER_ID = CLEARED_GLOBAL_PROFILE_PLUGIN_ID;

export function isEmptyBuiltinProfile(name: string): boolean {
  return name.trim() === CLEARED_GLOBAL_PROFILE_NAME;
}

export function isReservedProfileName(name: string): boolean {
  return isEmptyBuiltinProfile(name);
}

export function isProfilePlugin(plugin: Pick<Plugin, "tags">): boolean {
  return plugin.tags.includes(PROFILE_PLUGIN_TAG);
}

export function isProjectProfilePlugin(plugin: Pick<Plugin, "tags">): boolean {
  return isProfilePlugin(plugin) && plugin.tags.includes(PROJECT_PROFILE_TAG);
}

export function isAutoSeededDefaultProfileName(name: string): boolean {
  return name === LEGACY_DEFAULT_PROFILE_NAME || name === GLOBAL_DEFAULT_PROFILE_NAME;
}

/** @deprecated Use isProfilePlugin */
export const isProfileLayer = isProfilePlugin;

export function listProfilePlugins(): Plugin[] {
  return listPlugins().filter((plugin) => isProfilePlugin(plugin));
}

/** @deprecated Use listProfilePlugins */
export const listProfileLayers = listProfilePlugins;
