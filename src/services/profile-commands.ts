import { listPluginDependencies } from "../models/plugin-model.js";
import {
  createPlugin,
  getPluginByName,
  resolvePluginSelector,
  setPluginTags,
  updatePluginName,
} from "../models/plugin-model.js";
import { renameGlobalApplySnapshotsProfile } from "../models/global-apply-snapshot.js";
import { renamePluginTypedResources } from "../models/resource.js";
import {
  CLEARED_GLOBAL_PROFILE_NAME,
  PROFILE_PLUGIN_TAG,
  isEmptyBuiltinProfile,
  isProfilePlugin,
  isReservedProfileName,
  listProfilePlugins,
} from "../constants/profile.js";
import type { Plugin } from "../types.js";
import {
  clearActiveProfileName,
  getActiveProfileName,
  setActiveProfileName,
} from "./active-profile.js";
import { applyProfilePlugin, type ApplyProfilePluginOptions } from "./profile-apply.js";
import { withProfileApplyLock } from "./profile-apply-lock.js";

export interface CreateProfileResult {
  plugin: Plugin;
  created: boolean;
  promoted: boolean;
}

export class ProfileRenameError extends Error {
  readonly code: "invalid_name" | "not_found" | "plugin_exists" | "not_a_profile" | "reserved_name";

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

export function listProfilePluginsCommand() {
  const names = new Set<string>();
  for (const plugin of listProfilePlugins()) {
    names.add(plugin.name);
  }
  return [...names]
    .map((name) => getPluginByName(name))
    .filter((plugin): plugin is Plugin => plugin !== undefined && isProfilePlugin(plugin));
}

export function showProfileCommand(selector: string): {
  profile: Plugin;
  dependencies: ReturnType<typeof listPluginDependencies>;
  active: boolean;
} {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }

  const profile = resolvePluginSelector(selector);
  if (!profile) {
    throw new Error(`Profile not found: ${selector}`);
  }
  if (!isProfilePlugin(profile)) {
    throw new Error(`Plugin "${profile.name}" is not tagged as a profile`);
  }
  const activeProfile = getActiveProfileName();
  return {
    profile,
    dependencies: listPluginDependencies(profile.id),
    active: activeProfile === profile.name,
  };
}

export function getActiveProfilePayload(): {
  active_profile: string | null;
  plugin_id?: string;
  exists: boolean;
} {
  const activeProfile = getActiveProfileName();
  if (!activeProfile) {
    return {
      active_profile: null,
      exists: false,
    };
  }
  const plugin = resolvePluginSelector(activeProfile);
  return {
    active_profile: activeProfile,
    ...(plugin ? { plugin_id: plugin.id } : {}),
    exists: Boolean(plugin && isProfilePlugin(plugin)),
  };
}

export async function useProfileCommandUnlocked(
  selector: string,
  options: ApplyProfilePluginOptions,
) {
  const result = await applyProfilePlugin(selector, options);
  if (!result.cancelled && !result.dry_run) {
    setActiveProfileName(result.profile_name);
  }
  return result;
}

export async function useProfileCommand(
  selector: string,
  options: ApplyProfilePluginOptions,
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
  const existing = getPluginByName(input.name, version);
  if (existing) {
    if (isProfilePlugin(existing)) {
      return {
        plugin: existing,
        created: false,
        promoted: false,
      };
    }
    const tags = [...new Set([...existing.tags, PROFILE_PLUGIN_TAG])];
    setPluginTags(existing.id, tags);
    const refreshed = resolvePluginSelector(existing.name);
    if (!refreshed) {
      throw new Error(`Plugin not found after tagging: ${input.name}`);
    }
    return {
      plugin: refreshed,
      created: false,
      promoted: true,
    };
  }

  const plugin = createPlugin({
    name: input.name,
    description: input.description,
    version,
    tags: [PROFILE_PLUGIN_TAG],
  });
  return {
    plugin,
    created: true,
    promoted: true,
  };
}

export function tagProfileCommand(selector: string): {
  plugin_id: string;
  tags: string[];
} {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new Error(`Plugin not found: ${selector}`);
  }
  const tags = [...new Set([...plugin.tags, PROFILE_PLUGIN_TAG])];
  setPluginTags(plugin.id, tags);
  return { plugin_id: plugin.id, tags };
}

export function untagProfileCommand(selector: string): {
  plugin_id: string;
  tags: string[];
} {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new Error(`Plugin not found: ${selector}`);
  }
  const tags = plugin.tags.filter((tag) => tag !== PROFILE_PLUGIN_TAG);
  setPluginTags(plugin.id, tags);
  const activeProfile = getActiveProfileName();
  if (activeProfile === plugin.name) {
    clearActiveProfileName();
  }
  return { plugin_id: plugin.id, tags };
}

export function deleteProfileCommand(selector: string): {
  plugin_id: string;
  plugin_name: string;
  tags: string[];
  was_active: boolean;
} {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new Error(`Profile not found: ${selector}`);
  }
  if (!isProfilePlugin(plugin)) {
    throw new Error(`Plugin "${plugin.name}" is not tagged as a profile`);
  }
  const wasActive = getActiveProfileName() === plugin.name;
  const untagged = untagProfileCommand(selector);
  return {
    plugin_id: untagged.plugin_id,
    plugin_name: plugin.name,
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
  plugin_id: string;
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

  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new ProfileRenameError("not_found", `Profile not found: ${selector}`);
  }
  if (!isProfilePlugin(plugin)) {
    throw new ProfileRenameError(
      "not_a_profile",
      `Plugin "${plugin.name}" is not tagged as a profile`,
    );
  }

  const oldName = plugin.name;
  if (nextName === oldName) {
    const wasActive = getActiveProfileName() === oldName;
    return {
      old_name: oldName,
      name: oldName,
      plugin_id: plugin.id,
      was_active: wasActive,
    };
  }

  const conflicting = getPluginByName(nextName);
  if (conflicting && conflicting.id !== plugin.id) {
    throw new ProfileRenameError(
      "plugin_exists",
      `Plugin already exists: ${nextName}`,
    );
  }

  if (!updatePluginName(plugin.id, nextName)) {
    throw new ProfileRenameError("not_found", `Profile not found: ${selector}`);
  }

  renamePluginTypedResources(oldName, nextName);
  renameGlobalApplySnapshotsProfile(oldName, nextName);

  const wasActive = getActiveProfileName() === oldName;
  if (wasActive) {
    setActiveProfileName(nextName);
  }

  return {
    old_name: oldName,
    name: nextName,
    plugin_id: plugin.id,
    was_active: wasActive,
  };
}
