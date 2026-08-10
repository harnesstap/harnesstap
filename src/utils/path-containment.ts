import { readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export class PathEscapeError extends Error {
  readonly entry: string;

  constructor(entry: string, root: string) {
    super(`Path escapes the package root: ${entry} (root: ${root})`);
    this.name = "PathEscapeError";
    this.entry = entry;
  }
}

export function isContainedPath(root: string, entry: string): boolean {
  if (isAbsolute(entry)) return false;
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolve(resolvedRoot, entry));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function assertContainedPath(root: string, entry: string): void {
  if (!isContainedPath(root, entry)) {
    throw new PathEscapeError(entry, root);
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
      if (rel.startsWith("..") || isAbsolute(rel)) {
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
