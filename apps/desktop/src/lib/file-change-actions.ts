import { fileChangeAction } from "./contents-diff";
import type { DriftFileChange } from "./types";

export function fileChangeAbsolutePath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/\/+$/, "");
  const rel = relativePath.replace(/^\/+/, "");
  return `${root}/${rel}`;
}

export function fileChangeRowActions(
  change: DriftFileChange,
  opts: { rootPath: string | null; profileHasResource: boolean },
): {
  action: "add" | "update" | "remove";
  absolutePath: string | null;
  canOpen: boolean;
  canAdd: boolean;
  canDrop: boolean;
} {
  const mapped = fileChangeAction(change);
  const absolutePath = opts.rootPath
    ? fileChangeAbsolutePath(opts.rootPath, change.path)
    : null;
  const hasResource = Boolean(change.resource);
  const canOpen = Boolean(absolutePath);
  let canAdd = false;
  let canDrop = false;
  switch (mapped.action) {
    case "update":
      canAdd = hasResource;
      canDrop = true;
      break;
    case "remove":
      canAdd = hasResource;
      canDrop = hasResource && opts.profileHasResource;
      break;
    case "add":
      canAdd = false;
      canDrop = hasResource && opts.profileHasResource;
      break;
    default: {
      const _never: never = mapped.action;
      return _never;
    }
  }
  return { action: mapped.action, absolutePath, canOpen, canAdd, canDrop };
}
