import { tildeHomePath } from "./compact-path";
import { isPluginTypeResource } from "./plugin-ref-detail";
import {
  formatOriginDisplayLabel,
  isPackageEntryFileName,
  packageDirectoryDisplayPath,
} from "./resource-display";
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

function pathFileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function firstAbsolutePath(resource: LibraryResourceDetail): string {
  const filesystem = resource.filesystem_path?.trim() ?? "";
  if (filesystem && isAbsoluteFilesystemPath(filesystem)) {
    return filesystem;
  }
  const source = resource.source.trim();
  if (source && isAbsoluteFilesystemPath(source)) {
    return source;
  }
  const originRef = resource.origin_ref?.trim() ?? "";
  if (originRef && isAbsoluteFilesystemPath(originRef) && pathFileName(originRef).includes(".")) {
    return originRef;
  }
  return "";
}

function resourcePathDisplayAbsolute(resource: LibraryResourceDetail): string {
  if (isPluginTypeResource(resource.type)) {
    return resource.install_path?.trim() ?? "";
  }
  const source = resource.source.trim();
  const absolute = firstAbsolutePath(resource);
  if (absolute) {
    return packageDirectoryDisplayPath(absolute);
  }
  const candidate = source;
  if (isPackageEntryFileName(pathFileName(candidate))) {
    return packageDirectoryDisplayPath(candidate);
  }
  return source;
}

/**
 * Path shown in the inspect Path field: the resolved path with `$HOME` as `~`,
 * like the CLI. Copy, reveal and open use `resourceOpenPath` (absolute).
 */
export function resourcePathDisplay(resource: LibraryResourceDetail): string {
  const path = resourcePathDisplayAbsolute(resource);
  return isAbsoluteFilesystemPath(path) ? tildeHomePath(path) : path;
}

/** Origin field text; a local origin path shows `$HOME` as `~`. */
export function resourceOriginDisplay(resource: LibraryResourceDetail): string {
  const ref = resource.origin_ref?.trim() ?? "";
  return formatOriginDisplayLabel(
    resource.origin_kind,
    ref && isAbsoluteFilesystemPath(ref) ? tildeHomePath(ref) : ref,
    { includeRef: !isPluginTypeResource(resource.type) },
  );
}

/**
 * Absolute path for copy / reveal / open-in-editor.
 * Never returns a bare plugin-relative path such as `agents/devx.md`.
 */
export function resourceOpenPath(resource: LibraryResourceDetail): string {
  if (isPluginTypeResource(resource.type)) {
    return resource.install_path?.trim() ?? "";
  }
  const absolute = firstAbsolutePath(resource);
  if (absolute) {
    return packageDirectoryDisplayPath(absolute);
  }
  return "";
}

export function resourceOpenUsesSelector(resource: LibraryResourceDetail): boolean {
  return !isPluginTypeResource(resource.type);
}

export function resourcePathIsDirectory(resource: LibraryResourceDetail): boolean {
  if (isPluginTypeResource(resource.type)) {
    return true;
  }
  const source = resource.source.trim();
  const absolute = firstAbsolutePath(resource);
  return isPackageEntryFileName(pathFileName(absolute || source));
}
