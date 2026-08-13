import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { listProjects } from "../models/project.js";
import { listResourceTrackedDirectories } from "./resource-tracked-directories.js";
import { resolveHomeRoot } from "../utils/home-root.js";

export function openPathInSystemEditor(filePath: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [filePath];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", filePath];
  } else {
    command = "xdg-open";
    args = [filePath];
  }

  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Failed to open ${filePath}`);
  }
}

export function expandUserPath(candidate: string): string {
  const trimmed = candidate.trim();
  if (trimmed.startsWith("~/")) {
    return join(resolveHomeRoot(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return resolveHomeRoot();
  }
  return resolve(trimmed);
}

function realExistingPath(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isNestedOrEqual(root: string, target: string): boolean {
  if (target === root) {
    return true;
  }
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function collectAllowedOpenRoots(): string[] {
  const candidates = [
    getHarnesstapDir(),
    resolveHomeRoot(),
    ...listProjects().map((project) => project.local_path),
    ...listResourceTrackedDirectories().map((entry) => entry.path),
  ];
  const roots: string[] = [];
  for (const candidate of candidates) {
    const real = realExistingPath(candidate);
    if (real) {
      roots.push(real);
    }
  }
  return roots;
}

export function isPathUnderAllowedOpenRoots(realPath: string): boolean {
  return collectAllowedOpenRoots().some((root) => isNestedOrEqual(root, realPath));
}

export function resolveOpenableFilesystemPath(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error("Path is required");
  }

  const expanded = expandUserPath(trimmed);
  const real = realExistingPath(expanded);
  if (!real) {
    throw new Error(`Path is not an openable file or directory: ${candidate}`);
  }

  let isFileOrDirectory = false;
  try {
    const stat = statSync(real);
    isFileOrDirectory = stat.isFile() || stat.isDirectory();
  } catch {
    isFileOrDirectory = false;
  }
  if (!isFileOrDirectory) {
    throw new Error(`Path is not an openable file or directory: ${candidate}`);
  }

  if (!isPathUnderAllowedOpenRoots(real)) {
    throw new Error(`Path is outside allowed roots: ${real}`);
  }

  return real;
}
