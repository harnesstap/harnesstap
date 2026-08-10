import {
  CLEARED_GLOBAL_PROFILE_NAME,
  isEmptyBuiltinProfile,
  isProfilePlugin,
} from "../constants/profile.js";
import {
  addResourceToPlugin,
  getPluginById,
  getPluginResources,
  listPluginDependencies,
  removeResourceFromPlugin,
  resolvePluginSelector,
  setPluginTags,
  updatePluginDescription,
} from "../models/plugin-model.js";
import { getResource } from "../models/resource.js";
import type { Plugin, Resource } from "../types.js";
import { getActiveProfileName } from "./active-profile.js";
import {
  addPluginAttachment,
  formatPluginRef,
  removePluginAttachment,
} from "./plugin-composition.js";
import { markPluginDirty } from "./plugin-versioning.js";
import { ProfileRenameError, ProfileReservedNameError } from "./profile-commands.js";
import { toContentsResource } from "./profile-contents.js";

export interface ProfileDetailResource {
  id: string;
  type: string;
  name: string;
  source: string;
}

export interface ProfileDetailDependency {
  dependency_name: string;
  version_constraint: string;
  order: number;
  resource_id: string | null;
}

export interface ProfileDetail {
  profile: {
    id: string;
    name: string;
    version: string;
    description: string;
    tags: string[];
    dirty: boolean;
  };
  active: boolean;
  dependencies: ProfileDetailDependency[];
  resources: ProfileDetailResource[];
}

function resolveProfilePlugin(selector: string): Plugin {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
  const profile = resolvePluginSelector(selector);
  if (!profile) {
    throw new ProfileRenameError("not_found", `Profile not found: ${selector}`);
  }
  if (!isProfilePlugin(profile)) {
    throw new ProfileRenameError(
      "not_a_profile",
      `Plugin "${profile.name}" is not tagged as a profile`,
    );
  }
  return profile;
}

/** Direct attachments shown in Edit (material resources + plugin pins; not nested plugins). */
function editableDirectResources(resources: Resource[]): Resource[] {
  return resources.filter((resource) => {
    if (resource.type !== "plugin") {
      return true;
    }
    const metadata = resource.metadata as { source_kind?: string };
    return metadata.source_kind !== "local";
  });
}

function pluginRefResourceId(
  pluginId: string,
  dependencyName: string,
): string | null {
  const attached = getPluginResources(pluginId).find(
    (resource) =>
      resource.type === "plugin" &&
      resource.name === dependencyName &&
      (resource.metadata as { source_kind?: string }).source_kind === "local",
  );
  return attached?.id ?? null;
}

export function getProfileDetail(selector: string): ProfileDetail {
  const profile = resolveProfilePlugin(selector);
  const activeProfile = getActiveProfileName();
  const dependencies = listPluginDependencies(profile.id).map((dep) => ({
    dependency_name: dep.dependency_name,
    version_constraint: dep.version_constraint,
    order: dep.order,
    resource_id: pluginRefResourceId(profile.id, dep.dependency_name),
  }));
  const resources = editableDirectResources(getPluginResources(profile.id)).map(
    (resource) => toContentsResource(resource),
  );
  return {
    profile: {
      id: profile.id,
      name: profile.name,
      version: profile.version,
      description: profile.description ?? "",
      tags: profile.tags,
      dirty: profile.dirty,
    },
    active: activeProfile === profile.name,
    dependencies,
    resources,
  };
}

export function updateProfileMetadata(
  selector: string,
  input: { description?: string; tags?: string[] },
): ProfileDetail {
  const profile = resolveProfilePlugin(selector);
  if (input.description !== undefined) {
    updatePluginDescription(profile.id, input.description);
  }
  if (input.tags !== undefined) {
    const nextTags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
    if (!nextTags.includes("profile")) {
      nextTags.push("profile");
    }
    setPluginTags(profile.id, nextTags);
  }
  if (input.description !== undefined || input.tags !== undefined) {
    markPluginDirty(profile.id);
  }
  const refreshed = getPluginById(profile.id) ?? resolveProfilePlugin(selector);
  return getProfileDetail(refreshed.name);
}

export async function attachProfilePlugin(
  selector: string,
  pluginId: string,
): Promise<ProfileDetail> {
  const profile = resolveProfilePlugin(selector);
  const plugin = getPluginById(pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }
  if (plugin.id === profile.id) {
    throw new Error("A profile cannot depend on itself");
  }
  await addPluginAttachment({
    plugin: profile,
    selector: plugin.name,
    type: "plugin",
  });
  return getProfileDetail(profile.name);
}

export function attachProfileResource(
  selector: string,
  resourceId: string,
): ProfileDetail {
  const profile = resolveProfilePlugin(selector);
  const resource = getResource(resourceId);
  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }
  if (resource.type === "plugin") {
    throw new Error("Use plugin attachment for type \"plugin\"");
  }
  const already = getPluginResources(profile.id).some(
    (entry) => entry.id === resource.id,
  );
  if (!already) {
    addResourceToPlugin(profile.id, resource.id);
    markPluginDirty(profile.id);
  }
  return getProfileDetail(profile.name);
}

export function detachProfileAttachment(
  selector: string,
  input: { resourceId?: string; dependencyName?: string },
): ProfileDetail {
  const profile = resolveProfilePlugin(selector);
  if (input.dependencyName && input.dependencyName.trim()) {
    const result = removePluginAttachment({
      plugin: profile,
      selector: input.dependencyName.trim(),
      type: "plugin",
    });
    if (!result.removed) {
      throw new Error(result.message);
    }
    return getProfileDetail(profile.name);
  }
  if (input.resourceId && input.resourceId.trim()) {
    const resourceId = input.resourceId.trim();
    const attached = getPluginResources(profile.id).find(
      (entry) => entry.id === resourceId,
    );
    if (!attached) {
      throw new Error(`Attachment not found on profile: ${resourceId}`);
    }
    if (attached.type === "plugin") {
      removePluginAttachment({
        plugin: profile,
        selector: formatPluginRef(attached),
        type: "plugin",
      });
    } else {
      removeResourceFromPlugin(profile.id, resourceId);
      markPluginDirty(profile.id);
    }
    return getProfileDetail(profile.name);
  }
  throw new Error("resourceId or dependencyName is required");
}
