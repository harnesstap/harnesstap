import { getAllPlatforms } from "../platforms/registry.js";
import type { McpServerMetadata, Resource } from "../types.js";
import { isClaudeLocalMcpResource } from "./claude-local-mcp.js";
import {
  resourceAppliesToHarness,
  resourceHarnessScope,
} from "./harness-scope.js";

function normalizePath(path: string, rootPath = ""): string {
  let normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("~/")) {
    normalized = normalized.slice(2);
  }
  if (rootPath) {
    const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      normalized = normalized.slice(root.length).replace(/^\//, "");
    }
  }
  return normalized.replace(/^\.\//, "");
}

export function sourceMatchesManagedPath(
  source: string | undefined,
  managedPath: string,
  rootPath = "",
): boolean {
  if (!source) {
    return false;
  }
  const normalizedSource = normalizePath(source, rootPath);
  const normalizedManaged = normalizePath(managedPath, rootPath);
  return (
    normalizedSource === normalizedManaged
    || normalizedSource === `~/${normalizedManaged}`
    || normalizedManaged === `~/${normalizedSource}`
    || normalizedSource.replace(/^~\//, "") === normalizedManaged.replace(/^~\//, "")
  );
}

function stripHomePrefix(path: string): string {
  return normalizePath(path).replace(/^~\//, "");
}

function collectKnownMcpConfigPaths(): string[] {
  const paths: string[] = [];
  const looksLikeMcpConfig = (path: string): boolean =>
    /(^|\/)(\.?mcp\.json|mcp[-_]config\.json|opencode\.json)$/i.test(path);

  for (const platform of getAllPlatforms()) {
    for (const candidate of [
      platform.projectPaths.mcp,
      platform.globalPaths.mcp,
      platform.globalPaths.settings,
      platform.projectPaths.settings,
    ]) {
      if (!candidate) {
        continue;
      }
      const normalized = stripHomePrefix(candidate);
      if (
        candidate === platform.projectPaths.mcp
        || candidate === platform.globalPaths.mcp
        || looksLikeMcpConfig(normalized)
      ) {
        paths.push(normalized);
      }
    }
  }
  return [...new Set(paths)];
}

function sourcePointsAtKnownMcpPath(source: string, rootPath = ""): boolean {
  const known = collectKnownMcpConfigPaths();
  return known.some((path) => sourceMatchesManagedPath(source, path, rootPath));
}

function isPortableMcpSource(source: string | undefined): boolean {
  const trimmed = source?.trim();
  if (!trimmed || trimmed === "manual") {
    return true;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  // Manifest and package identities are not bound to a harness MCP file.
  return (
    normalized === "apm.yml" ||
    normalized.endsWith("/apm.yml") ||
    normalized === "plugin.json" ||
    normalized === "mcp.json"
  );
}

export function harnessIdsForMcpPath(
  targetMcpPath: string,
  rootPath = "",
): string[] {
  const ids: string[] = [];
  for (const platform of getAllPlatforms()) {
    const candidates = [
      platform.projectPaths.mcp,
      platform.globalPaths.mcp,
      platform.globalPaths.settings,
      platform.projectPaths.settings,
    ];
    if (candidates.some((candidate) => sourceMatchesManagedPath(candidate, targetMcpPath, rootPath))) {
      ids.push(platform.id);
    }
  }
  return ids;
}

export function isPortableMcpResource(resource: Pick<Resource, "type" | "metadata">): boolean {
  if (resource.type !== "mcp_server") {
    return false;
  }
  const meta = resource.metadata as McpServerMetadata;
  if (meta.transport !== "stdio" && meta.transport !== "http") {
    return false;
  }
  if (meta.connection_type || meta.framing || meta.claude_mcp_scope === "local") {
    return false;
  }
  for (const key of Object.keys(meta.env ?? {})) {
    if (/claude|codex|opencode|cursor/i.test(key)) {
      return false;
    }
  }
  return true;
}

/**
 * MCP servers to emit into a harness MCP config path.
 * Subset harness_scope wins. Unscoped resources keep source-path binding so
 * disk-captured servers stay on their origin until the user adds scope.
 * - Path-matched sources stay on that file.
 * - `manual` / empty / `apm.yml` / package `mcp.json` sources stay portable (all targets).
 * - Sources pointing at a *different* known MCP file are excluded.
 */
export function filterMcpServersForTargetPath(
  resources: Resource[],
  targetMcpPath: string | undefined,
  rootPath = "",
  platformId?: string,
): Resource[] {
  const mcps = resources.filter(
    (resource) =>
      resource.type === "mcp_server" && !isClaudeLocalMcpResource(resource),
  );
  if (!targetMcpPath) {
    return mcps;
  }

  const targetHarnesses = platformId
    ? [platformId]
    : harnessIdsForMcpPath(targetMcpPath, rootPath);

  return mcps.filter((resource) => {
    const scope = resourceHarnessScope(resource);
    if (scope.kind === "subset") {
      if (targetHarnesses.length === 0) {
        return false;
      }
      return targetHarnesses.some((id) => resourceAppliesToHarness(resource, id));
    }
    if (isPortableMcpSource(resource.source)) {
      return true;
    }
    if (sourceMatchesManagedPath(resource.source, targetMcpPath, rootPath)) {
      return true;
    }
    if (sourcePointsAtKnownMcpPath(resource.source ?? "", rootPath)) {
      return false;
    }
    return true;
  });
}
