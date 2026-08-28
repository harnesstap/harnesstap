import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export class PathEscapeError extends Error {
  readonly entry: string;

  constructor(entry: string, root: string) {
    super(`Path escapes the package root: ${entry} (root: ${root})`);
    this.name = "PathEscapeError";
    this.entry = entry;
  }
}

/** True when `rel` is outside the root (`..` or `../…`), not names that merely start with dots. */
function isOutsideRelative(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** True when any path segment is exactly `..` (not names that merely start with dots). */
export function hasParentTraversalSegment(entry: string): boolean {
  return entry.split(/[\\/]/).some((segment) => segment === "..");
}

export function isContainedPath(root: string, entry: string): boolean {
  if (isAbsolute(entry) || hasParentTraversalSegment(entry)) return false;
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolve(resolvedRoot, entry));
  return rel !== "" && !isOutsideRelative(rel);
}

export function assertContainedPath(root: string, entry: string): void {
  if (!isContainedPath(root, entry)) {
    throw new PathEscapeError(entry, root);
  }
}

/**
 * Validate archive member paths before extraction. Directory markers and `.`
 * are skipped; leading `./` is stripped.
 */
export function assertArchiveMembersContained(root: string, members: string[]): void {
  for (const member of members) {
    const trimmed = member.replace(/\/+$/, "");
    if (!trimmed || trimmed === ".") continue;
    const normalized = trimmed.replace(/^\.\//, "");
    assertContainedPath(root, normalized);
  }
}

/**
 * Walk `root` and return every file as a POSIX-style relative path.
 *
 * Entries are resolved through `realpath` so a symlink pointing outside the
 * root is rejected rather than followed, and visited real directories are
 * tracked so a cycle terminates instead of hanging.
 */
export function listContainedFiles(root: string): string[] {
  const resolvedRoot = realpathSync(resolve(root));
  const files: string[] = [];
  const visited = new Set<string>();

  const walk = (dir: string): void => {
    if (visited.has(dir)) return;
    visited.add(dir);

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const real = realpathSync(absolute);
      const rel = relative(resolvedRoot, real);
      if (isOutsideRelative(rel)) {
        throw new PathEscapeError(relative(resolvedRoot, absolute), resolvedRoot);
      }
      if (statSync(real).isDirectory()) {
        walk(real);
        continue;
      }
      files.push(relative(resolvedRoot, absolute).split(sep).join("/"));
    }
  };

  walk(resolvedRoot);
  return files;
}

export class BundleSymlinkError extends Error {
  readonly entry: string;

  constructor(entry: string) {
    super(`Symlinks are not allowed in a bundle: ${entry}`);
    this.name = "BundleSymlinkError";
    this.entry = entry;
  }
}

/**
 * Walk `root` and return every regular file as a POSIX-style relative path.
 * Any symlink (file or directory) is rejected rather than followed.
 */
export function listContainedRegularFiles(root: string): string[] {
  const resolvedRoot = resolve(root);
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const relativePath = relative(resolvedRoot, absolute).split(sep).join("/");
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        throw new BundleSymlinkError(relativePath);
      }
      if (isOutsideRelative(relative(resolvedRoot, absolute))) {
        throw new PathEscapeError(relativePath, resolvedRoot);
      }
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new BundleSymlinkError(relativePath);
      }
      files.push(relativePath);
    }
  };

  if (lstatSync(resolvedRoot).isSymbolicLink()) {
    throw new BundleSymlinkError(".");
  }
  walk(resolvedRoot);
  return files;
}
