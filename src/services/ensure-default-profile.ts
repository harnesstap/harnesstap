import { PROFILE_PLUGIN_TAG, isProfilePlugin, listProfilePlugins } from "../constants/profile.js";
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
import { createProfileCommand } from "./profile-commands.js";

export interface EnsureDefaultProfileResult {
  plugin: Plugin;
  created: boolean;
}

/**
 * When no profile plugins exist, seed a `default` profile (same name as `ht init`)
 * and point the active-profile pointer at it if unset.
 */
export function ensureDefaultProfilePlugin(): EnsureDefaultProfileResult {
  const existing = listProfilePlugins();
  const [first] = existing;
  if (first) {
    return { plugin: first, created: false };
  }

  const { plugin, created } = createProfileCommand({
    name: "default",
    description: "Default profile",
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
 * Create the `default` profile plugin when missing, then attach every
 * non-plugin library resource if the profile has none yet.
 */
export function seedDefaultProfileFromLibrary(): EnsureDefaultProfileResult {
  let plugin = listPlugins().find(
    (entry) => entry.name === "default" && isProfilePlugin(entry),
  );
  const created = !plugin;
  if (!plugin) {
    plugin = createPlugin({
      name: "default",
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

  setActiveProfileName("default");
  return { plugin, created };
}
