import {
  CLEARED_GLOBAL_PROFILE_NAME,
  isEmptyBuiltinProfile,
  isProfileLayer,
} from "../constants/profile.js";
import {
  addResourceToLayer,
  getLayerById,
  getLayerResources,
  listLayerDependencies,
  removeResourceFromLayer,
  resolveLayerSelector,
  setLayerTags,
  updateLayerDescription,
} from "../models/plugin-model.js";
import { getResource } from "../models/resource.js";
import type { Layer, Resource } from "../types.js";
import { getActiveProfileName } from "./active-profile.js";
import {
  addLayerAttachment,
  formatPluginRef,
  removeLayerAttachment,
} from "./layer-composition.js";
import { markLayerDirty } from "./layer-versioning.js";
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

function resolveProfileLayer(selector: string): Layer {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileReservedNameError(CLEARED_GLOBAL_PROFILE_NAME);
  }
  const profile = resolveLayerSelector(selector);
  if (!profile) {
    throw new ProfileRenameError("not_found", `Profile not found: ${selector}`);
  }
  if (!isProfileLayer(profile)) {
    throw new ProfileRenameError(
      "not_a_profile",
      `Layer "${profile.name}" is not tagged as a profile`,
    );
  }
  return profile;
}

/** Direct attachments shown in Edit (material resources + plugin pins; not nested layers). */
function editableDirectResources(resources: Resource[]): Resource[] {
  return resources.filter((resource) => {
    if (resource.type !== "plugin") {
      return true;
    }
    const metadata = resource.metadata as { source_kind?: string };
    return metadata.source_kind !== "local";
  });
}

function layerRefResourceId(
  layerId: string,
  dependencyName: string,
): string | null {
  const attached = getLayerResources(layerId).find(
    (resource) =>
      resource.type === "plugin" &&
      resource.name === dependencyName &&
      (resource.metadata as { source_kind?: string }).source_kind === "local",
  );
  return attached?.id ?? null;
}

export function getProfileDetail(selector: string): ProfileDetail {
  const profile = resolveProfileLayer(selector);
  const activeProfile = getActiveProfileName();
  const dependencies = listLayerDependencies(profile.id).map((dep) => ({
    dependency_name: dep.dependency_name,
    version_constraint: dep.version_constraint,
    order: dep.order,
    resource_id: layerRefResourceId(profile.id, dep.dependency_name),
  }));
  const resources = editableDirectResources(getLayerResources(profile.id)).map(
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
  const profile = resolveProfileLayer(selector);
  if (input.description !== undefined) {
    updateLayerDescription(profile.id, input.description);
  }
  if (input.tags !== undefined) {
    const nextTags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
    if (!nextTags.includes("profile")) {
      nextTags.push("profile");
    }
    setLayerTags(profile.id, nextTags);
  }
  if (input.description !== undefined || input.tags !== undefined) {
    markLayerDirty(profile.id);
  }
  const refreshed = getLayerById(profile.id) ?? resolveProfileLayer(selector);
  return getProfileDetail(refreshed.name);
}

export async function attachProfileLayer(
  selector: string,
  layerId: string,
): Promise<ProfileDetail> {
  const profile = resolveProfileLayer(selector);
  const layer = getLayerById(layerId);
  if (!layer) {
    throw new Error(`Layer not found: ${layerId}`);
  }
  if (layer.id === profile.id) {
    throw new Error("A profile cannot depend on itself");
  }
  await addLayerAttachment({
    layer: profile,
    selector: layer.name,
    type: "plugin",
  });
  return getProfileDetail(profile.name);
}

export function attachProfileResource(
  selector: string,
  resourceId: string,
): ProfileDetail {
  const profile = resolveProfileLayer(selector);
  const resource = getResource(resourceId);
  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }
  if (resource.type === "plugin") {
    throw new Error("Use layer attachment for type \"plugin\"");
  }
  const already = getLayerResources(profile.id).some(
    (entry) => entry.id === resource.id,
  );
  if (!already) {
    addResourceToLayer(profile.id, resource.id);
    markLayerDirty(profile.id);
  }
  return getProfileDetail(profile.name);
}

export function detachProfileAttachment(
  selector: string,
  input: { resourceId?: string; dependencyName?: string },
): ProfileDetail {
  const profile = resolveProfileLayer(selector);
  if (input.dependencyName && input.dependencyName.trim()) {
    const result = removeLayerAttachment({
      layer: profile,
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
    const attached = getLayerResources(profile.id).find(
      (entry) => entry.id === resourceId,
    );
    if (!attached) {
      throw new Error(`Attachment not found on profile: ${resourceId}`);
    }
    if (attached.type === "plugin") {
      removeLayerAttachment({
        layer: profile,
        selector: formatPluginRef(attached),
        type: "plugin",
      });
    } else {
      removeResourceFromLayer(profile.id, resourceId);
      markLayerDirty(profile.id);
    }
    return getProfileDetail(profile.name);
  }
  throw new Error("resourceId or dependencyName is required");
}
