import { isProfileLayer } from "../constants/profile.js";
import {
  getLayerResources,
  removeResourceFromLayer,
  resolveLayerSelector,
  touchLayerUpdatedAt,
} from "../models/plugin-model.js";
import { resolveResource } from "../models/resource.js";
import { collectProfileLayerIds } from "./profile-apply.js";
import { markLayerDirty } from "./layer-versioning.js";
import {
  type ProfileContentsResource,
  toContentsResource,
} from "./profile-contents.js";

const COMPOSITION_RESOURCE_TYPES = new Set(["plugin"]);

export function removeResourceFromProfile(input: {
  profileSelector: string;
  resourceType: string;
  resourceName: string;
  layerId?: string;
}): ProfileContentsResource {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }
  if (COMPOSITION_RESOURCE_TYPES.has(input.resourceType)) {
    throw new Error(`Cannot remove composition resource type: ${input.resourceType}`);
  }

  const stackLayerIds = collectProfileLayerIds(profileLayer);
  const stackLayerIdSet = new Set(stackLayerIds);
  if (input.layerId && !stackLayerIdSet.has(input.layerId)) {
    throw new Error(`Layer is not part of profile stack: ${input.layerId}`);
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
  const searchLayerIds = input.layerId ? [input.layerId] : stackLayerIds;
  let removedFromLayerId: string | null = null;
  for (const layerId of searchLayerIds) {
    const attached = getLayerResources(layerId);
    if (attached.some((resource) => resource.id === resourceId)) {
      markLayerDirty(layerId);
      removeResourceFromLayer(layerId, resourceId);
      touchLayerUpdatedAt(layerId);
      removedFromLayerId = layerId;
      break;
    }
  }

  if (!removedFromLayerId) {
    throw new Error(`Resource is not attached to profile: ${selector}`);
  }

  return toContentsResource(resolved.resource);
}
