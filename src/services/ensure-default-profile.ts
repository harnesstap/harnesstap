import {
  GLOBAL_DEFAULT_PROFILE_NAME,
  LEGACY_DEFAULT_PROFILE_NAME,
  PROFILE_PLUGIN_TAG,
  isProfilePlugin,
  listProfilePlugins,
} from "../constants/profile.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginResources,
  listPlugins,
} from "../models/plugin-model.js";
import { listResources } from "../models/resource.js";
import type { Plugin } from "../types.js";
import {
  getActiveProfileName,
  setActiveProfileName,
} from "./active-profile.js";
import { createProfileCommand, renameProfileCommand } from "./profile-commands.js";

export interface EnsureDefaultProfileResult {
  plugin: Plugin;
  created: boolean;
}

function findProfileByName(name: string): Plugin | undefined {
  return listPlugins().find((entry) => entry.name === name && isProfilePlugin(entry));
}

/**
 * Rename a leftover `default` profile plugin to `global default` when the
 * new name is free.
 */
export function migrateLegacyDefaultProfile(): Plugin | undefined {
  const already = findProfileByName(GLOBAL_DEFAULT_PROFILE_NAME);
  if (already) {
    return already;
  }
  const legacy = findProfileByName(LEGACY_DEFAULT_PROFILE_NAME);
  if (!legacy) {
    return undefined;
  }
  renameProfileCommand(legacy.name, GLOBAL_DEFAULT_PROFILE_NAME);
  return findProfileByName(GLOBAL_DEFAULT_PROFILE_NAME);
}

/**
 * When no profile plugins exist, seed a `global default` profile (same name as
 * `ht init`) and point the active-profile pointer at it if unset.
 */
export function ensureDefaultProfilePlugin(): EnsureDefaultProfileResult {
  migrateLegacyDefaultProfile();
  const existing = listProfilePlugins();
  const [first] = existing;
  if (first) {
    return { plugin: first, created: false };
  }

  const { plugin, created } = createProfileCommand({
    name: GLOBAL_DEFAULT_PROFILE_NAME,
    description: "Global default profile",
  });

  if (!getActiveProfileName()) {
    setActiveProfileName(plugin.name);
  }

  return { plugin, created };
}

function libraryResourcesForDefaultProfile() {
  return listResources().filter((resource) => resource.type !== "plugin");
}

/**
 * Create the `global default` profile plugin when missing, then attach every
 * non-plugin library resource if the profile has none yet.
 */
export function seedDefaultProfileFromLibrary(): EnsureDefaultProfileResult {
  migrateLegacyDefaultProfile();
  let plugin = findProfileByName(GLOBAL_DEFAULT_PROFILE_NAME);
  const created = !plugin;
  if (!plugin) {
    plugin = createPlugin({
      name: GLOBAL_DEFAULT_PROFILE_NAME,
      version: "1.0.0",
      description: "Bootstrap profile from init",
      tags: [PROFILE_PLUGIN_TAG],
    });
  }

  const attachedMaterial = getPluginResources(plugin.id).filter(
    (resource) => resource.type !== "plugin",
  );
  if (attachedMaterial.length === 0) {
    for (const resource of libraryResourcesForDefaultProfile()) {
      addResourceToPlugin(plugin.id, resource.id);
    }
  }

  setActiveProfileName(GLOBAL_DEFAULT_PROFILE_NAME);
  return { plugin, created };
}
