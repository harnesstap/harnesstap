import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { resolveResource } from "../models/resource.js";
import type { Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
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

function candidatePaths(resource: Resource, pathHint?: string | null): string[] {
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

function resolveExistingEditorPath(candidate: string): string | null {
  const expanded = expandUserPath(candidate);
  if (isOpenableFile(expanded)) {
    return expanded;
  }
  const skillMarkdown = join(expanded, "SKILL.md");
  if (isOpenableFile(skillMarkdown)) {
    return skillMarkdown;
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
  for (const candidate of candidatePaths(resource, input.pathHint)) {
    const resolved = resolveExistingEditorPath(candidate);
    if (resolved) {
      return resolved;
    }
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
