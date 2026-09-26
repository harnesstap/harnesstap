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

export type ListContainedFilesPageOptions = {
  /** Skip this many files before collecting. */
  offset?: number;
  /** Collect at most this many files. Omitted means the rest of the tree. */
  limit?: number;
  /** Directory names to skip (do not descend). */
  skipDirNames?: ReadonlySet<string>;
};

export type ContainedFilesPage = {
  files: string[];
  hasMore: boolean;
};

/**
 * Walk `root` in sorted-entry DFS order and return a page of files.
 * Stops after `offset + limit` files plus one extra to set `hasMore`,
 * so callers can paginate without walking the rest of the tree.
 */
export function listContainedFilesPage(
  root: string,
  options?: ListContainedFilesPageOptions,
): ContainedFilesPage {
  const resolvedRoot = realpathSync(resolve(root));
  const files: string[] = [];
  const visited = new Set<string>();
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = options?.limit;
  const skipDirNames = options?.skipDirNames;
  const want = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, limit);
  let skipped = 0;
  let hasMore = false;

  const walk = (dir: string): boolean => {
    if (visited.has(dir)) return false;
    visited.add(dir);

    const entries = readdirSync(dir, { withFileTypes: true }).slice().sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const real = realpathSync(absolute);
      const rel = relative(resolvedRoot, real);
      if (isOutsideRelative(rel)) {
        throw new PathEscapeError(relative(resolvedRoot, absolute), resolvedRoot);
      }
      if (statSync(real).isDirectory()) {
        if (skipDirNames?.has(entry.name)) {
          continue;
        }
        if (walk(real)) {
          return true;
        }
        continue;
      }
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      if (files.length >= want) {
        hasMore = true;
        return true;
      }
      files.push(relative(resolvedRoot, absolute).split(sep).join("/"));
    }
    return false;
  };

  walk(resolvedRoot);
  return { files, hasMore };
}

/**
 * Walk `root` and return every file as a POSIX-style relative path.
 *
 * Entries are resolved through `realpath` so a symlink pointing outside the
 * root is rejected rather than followed, and visited real directories are
 * tracked so a cycle terminates instead of hanging.
 */
export function listContainedFiles(root: string): string[] {
  return listContainedFilesPage(root).files;
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
