import { getAllPlatforms } from "../platforms/registry.js";
import type { Resource } from "../types.js";

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
      // Only treat settings paths as MCP when the filename is an MCP config.
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
  return !trimmed || trimmed === "manual";
}

/**
 * MCP servers to emit into a harness MCP config path.
 * - Path-matched sources stay on that file.
 * - `manual` / empty sources stay portable (all targets).
 * - Sources pointing at a *different* known MCP file are excluded.
 */
export function filterMcpServersForTargetPath(
  resources: Resource[],
  targetMcpPath: string | undefined,
  rootPath = "",
): Resource[] {
  const mcps = resources.filter((resource) => resource.type === "mcp_server");
  if (!targetMcpPath) {
    return mcps;
  }

  return mcps.filter((resource) => {
    if (isPortableMcpSource(resource.source)) {
      return true;
    }
    if (sourceMatchesManagedPath(resource.source, targetMcpPath, rootPath)) {
      return true;
    }
    // Bound to another harness MCP file — do not cross-write.
    if (sourcePointsAtKnownMcpPath(resource.source ?? "", rootPath)) {
      return false;
    }
    return true;
  });
}
