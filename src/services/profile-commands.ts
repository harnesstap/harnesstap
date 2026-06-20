import { listLayerDependencies } from "../models/layer-model.js";
import {
  createLayer,
  getLayerByName,
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

export interface CreateProfileResult {
  layer: Layer;
  created: boolean;
  promoted: boolean;
}

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
}): CreateProfileResult {
  const version = input.version ?? "1.0.0";
  const existing = getLayerByName(input.name, version);
  if (existing) {
    if (isProfileLayer(existing)) {
      return {
        layer: existing,
        created: false,
        promoted: false,
      };
    }
    const tags = [...new Set([...existing.tags, PROFILE_LAYER_TAG])];
    setLayerTags(existing.id, tags);
    const refreshed = resolveLayerSelector(existing.name);
    if (!refreshed) {
      throw new Error(`Layer not found after tagging: ${input.name}`);
    }
    return {
      layer: refreshed,
      created: false,
      promoted: true,
    };
  }

  const layer = createLayer({
    name: input.name,
    description: input.description,
    version,
    tags: [PROFILE_LAYER_TAG],
  });
  return {
    layer,
    created: true,
    promoted: true,
  };
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

export function deleteProfileCommand(selector: string): {
  layer_id: string;
  layer_name: string;
  tags: string[];
  was_active: boolean;
} {
  const layer = resolveLayerSelector(selector);
  if (!layer) {
    throw new Error(`Profile not found: ${selector}`);
  }
  if (!isProfileLayer(layer)) {
    throw new Error(`Layer "${layer.name}" is not tagged as a profile`);
  }
  const wasActive = getActiveProfileName() === layer.name;
  const untagged = untagProfileCommand(selector);
  return {
    layer_id: untagged.layer_id,
    layer_name: layer.name,
    tags: untagged.tags,
    was_active: wasActive,
  };
}
