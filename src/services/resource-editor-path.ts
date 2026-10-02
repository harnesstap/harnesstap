import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { resolveResource } from "../models/resource.js";
import type { Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { listExistingInstallRoots } from "./resource-sync.js";
import { isUntrackedResourceSelector } from "./untracked-resource.js";

function expandUserPath(candidate: string): string {
  const trimmed = candidate.trim();
  if (trimmed.startsWith("~/")) {
    return join(resolveHomeRoot(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return resolveHomeRoot();
  }
  return resolve(trimmed);
}

function isOpenableFile(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out;
}

function extensionForResourceType(type: string): string {
  switch (type) {
    case "skill":
    case "instruction":
    case "rule":
    case "agent":
    case "command":
      return ".md";
    case "hook":
      return ".json";
    default:
      return ".txt";
  }
}

function scratchPathForResource(resource: Resource): string {
  const safeName = resource.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return join(
    getHarnesstapDir(),
    "editor-scratch",
    resource.type,
    `${safeName}${extensionForResourceType(resource.type)}`,
  );
}

function candidatePaths(
  resource: Pick<Resource, "source" | "origin_ref">,
  pathHint?: string | null,
): string[] {
  const candidates: string[] = [];
  if (pathHint?.trim()) {
    candidates.push(pathHint.trim());
  }
  if (resource.source?.trim() && resource.source !== "manual") {
    candidates.push(resource.source.trim());
  }
  if (resource.origin_ref?.trim()) {
    candidates.push(resource.origin_ref.trim());
  }
  return candidates;
}

function isPluginRefHint(candidate: string): boolean {
  return candidate.includes("@") && !candidate.includes("/") && !candidate.includes("\\");
}

function looksLikeFilesystemSource(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed === "manual" || trimmed.startsWith("composition:")) {
    return false;
  }
  return true;
}

function isBareRelativePath(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!looksLikeFilesystemSource(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("~") || isAbsolute(trimmed) || isPluginRefHint(trimmed)) {
    return false;
  }
  return true;
}

function installRootsForResource(
  resource: Pick<Resource, "origin_ref">,
): string[] {
  const originRef = resource.origin_ref?.trim();
  if (!originRef) {
    return [];
  }
  return listExistingInstallRoots(originRef);
}

function originDirectory(
  resource: Pick<Resource, "origin_ref">,
): string | null {
  const originRef = resource.origin_ref?.trim();
  if (!originRef || !looksLikeFilesystemSource(originRef) || isPluginRefHint(originRef)) {
    return null;
  }
  const expanded = expandUserPath(originRef);
  return isExistingDirectory(expanded) ? expanded : null;
}

/** Plugin install trees, origin dir, then the shared `~/.agents` hub. */
function lookupRootsForResource(
  resource: Pick<Resource, "origin_ref">,
): string[] {
  const roots = [...installRootsForResource(resource)];
  const originDir = originDirectory(resource);
  if (originDir) {
    roots.push(originDir);
    roots.push(join(originDir, ".agents"));
  }
  roots.push(join(resolveHomeRoot(), ".agents"));
  return uniquePaths(roots);
}

function canonicalizeExistingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function openableFileOrSkill(path: string): string | null {
  if (isOpenableFile(path)) {
    return canonicalizeExistingPath(path);
  }
  const skillMarkdown = join(path, "SKILL.md");
  if (isOpenableFile(skillMarkdown)) {
    return canonicalizeExistingPath(skillMarkdown);
  }
  return null;
}

function resolveExistingEditorPath(
  candidate: string,
  roots: string[] = [],
): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  if (isBareRelativePath(trimmed)) {
    for (const root of roots) {
      const fromRoot = openableFileOrSkill(resolve(root, trimmed));
      if (fromRoot) {
        return fromRoot;
      }
    }
  }

  return openableFileOrSkill(expandUserPath(trimmed));
}

export function resolveExistingResourceFilesystemPath(
  resource: Pick<Resource, "source" | "origin_ref">,
  pathHint?: string | null,
): string | null {
  const roots = lookupRootsForResource(resource);
  for (const candidate of candidatePaths(resource, pathHint)) {
    const resolved = resolveExistingEditorPath(candidate, roots);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

export function readResourceContentFromPathHint(pathHint: string): {
  path: string;
  content: string;
  updatedAt: string;
} {
  const resolved = resolveExistingEditorPath(pathHint);
  if (!resolved) {
    throw new Error(`Path is not an openable file: ${pathHint}`);
  }
  const stat = statSync(resolved);
  return {
    path: resolved,
    content: readFileSync(resolved, "utf-8"),
    updatedAt: new Date(stat.mtimeMs).toISOString(),
  };
}

export function resolveResourceEditorPath(input: {
  selector: string;
  pathHint?: string | null;
}): string {
  const trimmedSelector = input.selector.trim();
  if (!trimmedSelector) {
    throw new Error("Resource selector is required");
  }

  if (isUntrackedResourceSelector(trimmedSelector)) {
    if (!input.pathHint?.trim()) {
      throw new Error(`Resource not found: ${trimmedSelector}`);
    }
    return resolveEditorPath(input.pathHint);
  }

  const result = resolveResource(trimmedSelector);
  if (result.status === "not_found") {
    throw new Error(`Resource not found: ${trimmedSelector}`);
  }
  if (result.status === "ambiguous") {
    throw new Error(`Ambiguous resource selector: ${trimmedSelector}`);
  }

  const resource = result.resource;
  const roots = lookupRootsForResource(resource);
  const candidates = candidatePaths(resource, input.pathHint);
  for (const candidate of candidates) {
    const resolved = resolveExistingEditorPath(candidate, roots);
    if (resolved) {
      return resolved;
    }
  }

  const diskHint = candidates.find((candidate) => looksLikeFilesystemSource(candidate));
  if (diskHint) {
    throw new Error(`Path is not an openable file: ${diskHint}`);
  }

  const scratchPath = scratchPathForResource(resource);
  mkdirSync(dirname(scratchPath), { recursive: true });
  writeFileSync(scratchPath, resource.content, "utf-8");
  return scratchPath;
}

export function resolveEditorPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Path is required");
  }
  const resolved = resolveExistingEditorPath(trimmed);
  if (!resolved) {
    throw new Error(`Path is not an openable file: ${path}`);
  }
  return resolved;
}
