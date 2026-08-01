import { listLayerDependencies } from "../models/layer-model.js";
import {
  createLayer,
  getLayerByName,
  resolveLayerSelector,
  setLayerTags,
  updateLayerName,
} from "../models/layer-model.js";
import { renameGlobalApplySnapshotsProfile } from "../models/global-apply-snapshot.js";
import { renameLayerTypedResources } from "../models/resource.js";
import {
  CLEARED_GLOBAL_PROFILE_NAME,
  PROFILE_LAYER_TAG,
  isEmptyBuiltinProfile,
  isProfileLayer,
  isReservedProfileName,
  listProfileLayers,
} from "../constants/profile.js";
import type { Layer } from "../types.js";
import {
  clearActiveProfileName,
  getActiveProfileName,
  setActiveProfileName,
} from "./active-profile.js";
import { applyProfileLayer, type ApplyProfileLayerOptions } from "./profile-apply.js";
import { withProfileApplyLock } from "./profile-apply-lock.js";

export interface CreateProfileResult {
  layer: Layer;
  created: boolean;
  promoted: boolean;
}

export class ProfileRenameError extends Error {
  readonly code: "invalid_name" | "not_found" | "layer_exists" | "not_a_profile" | "reserved_name";

  constructor(
    code: ProfileRenameError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ProfileRenameError";
    this.code = code;
  }
}

export class ProfileReservedNameError extends Error {
  constructor(name: string) {
    super(
      `"${name}" is a reserved profile name and cannot be created, renamed to, or deleted`,
    );
    this.name = "ProfileReservedNameError";
  }
}

function assertNotReservedProfileName(name: string): void {
  if (isReservedProfileName(name)) {
    throw new ProfileReservedNameError(name);
  }
}

export function listProfileLayersCommand() {
  return listProfileLayers();
}

export function showProfileCommand(selector: string): {
  profile: Layer;
  dependencies: ReturnType<typeof listLayerDependencies>;
  active: boolean;
} {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }

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

export async function useProfileCommandUnlocked(
  selector: string,
  options: ApplyProfileLayerOptions,
) {
  const result = await applyProfileLayer(selector, options);
  if (!result.cancelled && !result.dry_run) {
    setActiveProfileName(result.profile_name);
  }
  return result;
}

export async function useProfileCommand(
  selector: string,
  options: ApplyProfileLayerOptions,
) {
  return withProfileApplyLock(() => useProfileCommandUnlocked(selector, options));
}

export function createProfileCommand(input: {
  name: string;
  description?: string;
  version?: string;
}): CreateProfileResult {
  assertNotReservedProfileName(input.name);
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
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
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
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
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
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
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

export function renameProfileCommand(
  selector: string,
  nextNameInput: string,
): {
  old_name: string;
  name: string;
  layer_id: string;
  was_active: boolean;
} {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileRenameError(
      "reserved_name",
      `"${CLEARED_GLOBAL_PROFILE_NAME}" is a reserved profile name and cannot be renamed`,
    );
  }

  const nextName = nextNameInput.trim();
  if (!nextName) {
    throw new ProfileRenameError("invalid_name", "Profile name is required");
  }
  if (isReservedProfileName(nextName)) {
    throw new ProfileRenameError(
      "reserved_name",
      `"${CLEARED_GLOBAL_PROFILE_NAME}" is a reserved profile name`,
    );
  }

  const layer = resolveLayerSelector(selector);
  if (!layer) {
    throw new ProfileRenameError("not_found", `Profile not found: ${selector}`);
  }
  if (!isProfileLayer(layer)) {
    throw new ProfileRenameError(
      "not_a_profile",
      `Layer "${layer.name}" is not tagged as a profile`,
    );
  }

  const oldName = layer.name;
  if (nextName === oldName) {
    const wasActive = getActiveProfileName() === oldName;
    return {
      old_name: oldName,
      name: oldName,
      layer_id: layer.id,
      was_active: wasActive,
    };
  }

  const conflicting = getLayerByName(nextName);
  if (conflicting && conflicting.id !== layer.id) {
    throw new ProfileRenameError(
      "layer_exists",
      `Layer already exists: ${nextName}`,
    );
  }

  if (!updateLayerName(layer.id, nextName)) {
    throw new ProfileRenameError("not_found", `Profile not found: ${selector}`);
  }

  renameLayerTypedResources(oldName, nextName);
  renameGlobalApplySnapshotsProfile(oldName, nextName);

  const wasActive = getActiveProfileName() === oldName;
  if (wasActive) {
    setActiveProfileName(nextName);
  }

  return {
    old_name: oldName,
    name: nextName,
    layer_id: layer.id,
    was_active: wasActive,
  };
}
