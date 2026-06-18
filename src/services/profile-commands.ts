import { listLayerDependencies } from "../models/layer-model.js";
import {
  createLayer,
  resolveLayerSelector,
  setLayerTags,
} from "../models/layer-model.js";
import { PROFILE_LAYER_TAG, isProfileLayer, listProfileLayers } from "../constants/profile.js";
import type { Layer } from "../types.js";
import {
  clearActiveProfileName,
  getActiveProfileName,
  setActiveProfileName,
} from "./active-profile.js";
import { applyProfileLayer, type ApplyProfileLayerOptions } from "./profile-apply.js";

export function listProfileLayersCommand() {
  return listProfileLayers();
}

export function showProfileCommand(selector: string): {
  profile: Layer;
  dependencies: ReturnType<typeof listLayerDependencies>;
  active: boolean;
} {
  const profile = resolveLayerSelector(selector);
  if (!profile) {
    throw new Error(`Profile not found: ${selector}`);
  }
  if (!isProfileLayer(profile)) {
    throw new Error(`Layer "${profile.name}" is not tagged as a profile`);
  }
  const activeProfile = getActiveProfileName();
  return {
    profile,
    dependencies: listLayerDependencies(profile.id),
    active: activeProfile === profile.name,
  };
}

export function getActiveProfilePayload(): {
  active_profile: string | null;
  layer_id?: string;
  exists: boolean;
} {
  const activeProfile = getActiveProfileName();
  if (!activeProfile) {
    return {
      active_profile: null,
      exists: false,
    };
  }
  const layer = resolveLayerSelector(activeProfile);
  return {
    active_profile: activeProfile,
    ...(layer ? { layer_id: layer.id } : {}),
    exists: Boolean(layer && isProfileLayer(layer)),
  };
}

export async function useProfileCommand(
  selector: string,
  options: ApplyProfileLayerOptions,
) {
  const result = await applyProfileLayer(selector, options);
  if (!result.cancelled && !result.dry_run) {
    setActiveProfileName(result.profile_name);
  }
  return result;
}

export function createProfileCommand(input: {
  name: string;
  description?: string;
  version?: string;
}) {
  return createLayer({
    name: input.name,
    description: input.description,
    version: input.version,
    tags: [PROFILE_LAYER_TAG],
  });
}

export function tagProfileCommand(selector: string): {
  layer_id: string;
  tags: string[];
} {
  const layer = resolveLayerSelector(selector);
  if (!layer) {
    throw new Error(`Layer not found: ${selector}`);
  }
  const tags = [...new Set([...layer.tags, PROFILE_LAYER_TAG])];
  setLayerTags(layer.id, tags);
  return { layer_id: layer.id, tags };
}

export function untagProfileCommand(selector: string): {
  layer_id: string;
  tags: string[];
} {
  const layer = resolveLayerSelector(selector);
  if (!layer) {
    throw new Error(`Layer not found: ${selector}`);
  }
  const tags = layer.tags.filter((tag) => tag !== PROFILE_LAYER_TAG);
  setLayerTags(layer.id, tags);
  const activeProfile = getActiveProfileName();
  if (activeProfile === layer.name) {
    clearActiveProfileName();
  }
  return { layer_id: layer.id, tags };
}
