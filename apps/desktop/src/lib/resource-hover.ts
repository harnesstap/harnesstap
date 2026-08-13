import {
  fileChangeDestinationSummary,
  inferFileChangeType,
  type FileChangeResourceGroup,
} from "./contents-diff";
import { relatedHarnessesForResourceType } from "./harness-meta";
import { resourceDisplayName } from "./resource-search";
import type {
  DriftFileChange,
  LibraryResource,
  ProfileContentsResource,
} from "./types";

export type ResourceHoverExtra = {
  kind: "destinations";
  text: string;
};

export type ResourceHoverModel = {
  type?: string;
  name: string;
  path?: string;
  originKind?: string;
  harnessIds: string[];
  extra: ResourceHoverExtra[];
};

export function formatHoverPath(path: string): string {
  return path.replaceAll("/", "/\u200b");
}

export function resourceHoverCardHasContent(model: ResourceHoverModel): boolean {
  if (model.type !== undefined) {
    return true;
  }
  if (model.path !== undefined) {
    return true;
  }
  if (model.originKind !== undefined) {
    return true;
  }
  if (model.harnessIds.length > 0) {
    return true;
  }
  if (model.extra.length > 0) {
    return true;
  }
  return false;
}

export function hoverModelFromLibraryResource(
  resource: LibraryResource,
): ResourceHoverModel {
  const model: ResourceHoverModel = {
    type: resource.type,
    name: resourceDisplayName(resource),
    harnessIds: [...relatedHarnessesForResourceType(resource.type)],
    extra: [],
  };
  const path = resource.source?.trim();
  if (path) {
    model.path = path;
  }
  const origin = resource.origin_kind?.trim();
  if (origin) {
    model.originKind = origin;
  }
  return model;
}

export function hoverModelFromProfileResource(
  resource: ProfileContentsResource,
): ResourceHoverModel {
  const model: ResourceHoverModel = {
    type: resource.type,
    name: resource.name,
    harnessIds: [...relatedHarnessesForResourceType(resource.type)],
    extra: [],
  };
  const path = resource.source?.trim();
  if (path) {
    model.path = path;
  }
  return model;
}

export function hoverModelFromFileChangeGroup(
  group: FileChangeResourceGroup,
): ResourceHoverModel {
  const firstPath = group.changes[0]?.path ?? "";
  const type = group.resource?.type ?? inferFileChangeType(firstPath);
  const model: ResourceHoverModel = {
    name: group.resource?.name ?? firstPath,
    harnessIds: [...group.platforms],
    extra: [],
  };
  if (type) {
    model.type = type;
  }
  if (firstPath) {
    model.path = firstPath;
  }
  const origin = group.resource?.origin_kind?.trim();
  if (origin) {
    model.originKind = origin;
  }
  const destinations = fileChangeDestinationSummary(group);
  if (destinations) {
    model.extra.push({ kind: "destinations", text: destinations });
  }
  return model;
}

export function hoverModelFromFileChangeChild(
  change: DriftFileChange,
): ResourceHoverModel {
  return {
    name: change.path,
    path: change.path,
    harnessIds: change.platform ? [change.platform] : [],
    extra: [],
  };
}
