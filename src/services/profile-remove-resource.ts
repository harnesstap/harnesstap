import { isProfilePlugin } from "../constants/profile.js";
import {
  getPluginResources,
  removeResourceFromPlugin,
  resolvePluginSelector,
  touchPluginUpdatedAt,
} from "../models/plugin-model.js";
import { resolveResource } from "../models/resource.js";
import { collectProfilePluginIds } from "./profile-apply.js";
import { markPluginDirty } from "./plugin-versioning.js";
import {
  type ProfileContentsResource,
  toContentsResource,
} from "./profile-contents.js";

const COMPOSITION_RESOURCE_TYPES = new Set(["plugin"]);

export function removeResourceFromProfile(input: {
  profileSelector: string;
  resourceType: string;
  resourceName: string;
  pluginId?: string;
}): ProfileContentsResource {
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
  }
  if (COMPOSITION_RESOURCE_TYPES.has(input.resourceType)) {
    throw new Error(`Cannot remove composition resource type: ${input.resourceType}`);
  }

  const stackPluginIds = collectProfilePluginIds(profilePlugin);
  const stackPluginIdSet = new Set(stackPluginIds);
  if (input.pluginId && !stackPluginIdSet.has(input.pluginId)) {
    throw new Error(`Plugin is not part of profile stack: ${input.pluginId}`);
  }

  const selector = `${input.resourceType}:${input.resourceName}`;
  const resolved = resolveResource(selector, { mode: "compose" });
  if (resolved.status === "not_found") {
    throw new Error(`Resource not found in profile: ${selector}`);
  }
  if (resolved.status === "ambiguous") {
    throw new Error(`Ambiguous resource selector: ${selector}`);
  }

  const resourceId = resolved.resource.id;
  const searchPluginIds = input.pluginId ? [input.pluginId] : stackPluginIds;
  let removedFromPluginId: string | null = null;
  for (const pluginId of searchPluginIds) {
    const attached = getPluginResources(pluginId);
    if (attached.some((resource) => resource.id === resourceId)) {
      markPluginDirty(pluginId);
      removeResourceFromPlugin(pluginId, resourceId);
      touchPluginUpdatedAt(pluginId);
      removedFromPluginId = pluginId;
      break;
    }
  }

  if (!removedFromPluginId) {
    throw new Error(`Resource is not attached to profile: ${selector}`);
  }

  return toContentsResource(resolved.resource);
}
