import { isPluginTypeResource } from "./plugin-ref-detail";
import type { LibraryResourceDetail } from "./types";

function isAbsoluteFilesystemPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed === "~") {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(trimmed);
}

/** Path shown in the inspect Path field. Plugin-relative sources stay short. */
export function resourcePathDisplay(resource: LibraryResourceDetail): string {
  if (isPluginTypeResource(resource.type)) {
    return resource.install_path?.trim() ?? "";
  }
  return resource.source.trim();
}

/**
 * Absolute path for copy / reveal / open-in-editor.
 * Never returns a bare plugin-relative path such as `agents/devx.md`.
 */
export function resourceOpenPath(resource: LibraryResourceDetail): string {
  if (isPluginTypeResource(resource.type)) {
    return resource.install_path?.trim() ?? "";
  }
  const filesystem = resource.filesystem_path?.trim() ?? "";
  if (filesystem && isAbsoluteFilesystemPath(filesystem)) {
    return filesystem;
  }
  const source = resource.source.trim();
  if (source && isAbsoluteFilesystemPath(source)) {
    return source;
  }
  const originRef = resource.origin_ref?.trim() ?? "";
  if (originRef && isAbsoluteFilesystemPath(originRef)) {
    return originRef;
  }
  return "";
}

export function resourceOpenUsesSelector(resource: LibraryResourceDetail): boolean {
  return !isPluginTypeResource(resource.type);
}
