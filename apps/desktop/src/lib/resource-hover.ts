import {
  fileChangeDestinationSummary,
  inferFileChangeType,
  type ContentsDiffItem,
  type FileChangeResourceGroup,
} from "./contents-diff";
import { relatedHarnessesForResourceType } from "./harness-meta";
import { libraryFilterType } from "./library-list";
import { isPluginTypeResource } from "./plugin-ref-detail";
import { resourceDisplayName } from "./resource-search";
import type {
  DriftFileChange,
  LibraryResource,
  ProfileContentsResource,
} from "./types";

export type ResourceHoverExtra = {
  kind: "destinations" | "note";
  text: string;
};

export type ResourceHoverModel = {
  type?: string;
  name: string;
  path?: string;
  originKind?: string;
  originRef?: string;
  originIncludeRef?: boolean;
  harnessIds: string[];
  extra: ResourceHoverExtra[];
};

export function formatHoverPath(path: string): string {
  return path.replaceAll("/", "/\u200b");
}

/** Gap between the pointer and the tooltip’s top-left corner. */
export const POINTER_HOVER_MARGIN_PX = 6;

/** Viewport inset used when flipping or shifting so the card stays on-screen. */
export const POINTER_HOVER_VIEWPORT_PADDING_PX = 8;

function clampAxis(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Place a tooltip down-right of the pointer (top-left + margin). Flip to the
 * left or above when that default would clip, then shift into the viewport.
 */
export function clampPointerHoverCardPosition(
  pointer: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = POINTER_HOVER_MARGIN_PX,
  padding = POINTER_HOVER_VIEWPORT_PADDING_PX,
): { left: number; top: number } {
  const maxLeft = viewport.width - padding - size.width;
  const maxTop = viewport.height - padding - size.height;
  const left = pointer.x + margin + size.width <= viewport.width - padding
    ? pointer.x + margin
    : pointer.x - margin - size.width;
  const top = pointer.y + margin + size.height <= viewport.height - padding
    ? pointer.y + margin
    : pointer.y - margin - size.height;
  return {
    left: clampAxis(left, padding, maxLeft),
    top: clampAxis(top, padding, maxTop),
  };
}

export function pointerHoverCardStyle(position: { left: number; top: number }): {
  position: "fixed";
  left: number;
  top: number;
  pointerEvents: "none";
} {
  return {
    position: "fixed",
    left: position.left,
    top: position.top,
    pointerEvents: "none",
  };
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
  const filterType = libraryFilterType(resource);
  const model: ResourceHoverModel = {
    type: filterType,
    name: resourceDisplayName(resource),
    harnessIds: [...relatedHarnessesForResourceType(filterType)],
    extra: [],
  };
  const path = resource.source?.trim();
  if (path) {
    model.path = path;
  }
  const origin = resource.origin_kind?.trim();
  if (origin) {
    model.originKind = origin;
    const originRef = resource.origin_ref?.trim();
    if (originRef) {
      model.originRef = originRef;
    }
    model.originIncludeRef = !isPluginTypeResource(resource.type);
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

export function hoverModelFromContentsDiffItem(
  item: ContentsDiffItem,
): ResourceHoverModel {
  const model: ResourceHoverModel = {
    type: item.iconType,
    name: item.label,
    harnessIds: [...relatedHarnessesForResourceType(item.iconType)],
    extra: [],
  };
  const path = item.path?.trim();
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
    model.originIncludeRef = false;
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
