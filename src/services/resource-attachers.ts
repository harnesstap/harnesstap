import { isProfilePlugin } from "../constants/profile.js";
import {
  getPlugin,
  getPluginResources,
  listPluginsAttachingResource,
} from "../models/plugin-model.js";
import { getActiveProfileName } from "./active-profile.js";
import { collectProfilePluginIds } from "./profile-apply.js";

export interface ResourceAttacherPayload {
  attached_profiles: string[];
  attached_plugins: string[];
  active_profile: string | null;
  in_active_profile: boolean;
}

export function resourceAttacherPayload(resourceId: string): ResourceAttacherPayload {
  const attachers = listPluginsAttachingResource(resourceId);
  const profiles: string[] = [];
  const plugins: string[] = [];
  for (const plugin of attachers) {
    if (isProfilePlugin(plugin)) {
      profiles.push(plugin.name);
    } else {
      plugins.push(plugin.name);
    }
  }
  const activeProfile = getActiveProfileName() ?? null;
  return {
    attached_profiles: profiles,
    attached_plugins: plugins,
    active_profile: activeProfile,
    in_active_profile: resourceIsInActiveProfile(resourceId, activeProfile),
  };
}

function resourceIsInActiveProfile(
  resourceId: string,
  activeProfile: string | null,
): boolean {
  if (!activeProfile) {
    return false;
  }
  const profilePlugin = getPlugin(activeProfile);
  if (!profilePlugin || !isProfilePlugin(profilePlugin)) {
    return false;
  }
  let stackIds: string[];
  try {
    stackIds = collectProfilePluginIds(profilePlugin);
  } catch {
    stackIds = [profilePlugin.id];
  }
  for (const pluginId of stackIds) {
    if (getPluginResources(pluginId).some((resource) => resource.id === resourceId)) {
      return true;
    }
  }
  return false;
}
