import { existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { listResourcesMatchingOriginRef } from "../models/resource.js";
import type { PluginDependencyMetadata, Resource } from "../types.js";
import {
  containedFileStem,
  inferContainedFileType,
  isPackageEntryFileName,
  packageDirectoryDisplayPath,
} from "../ui/resource-display.js";
import { listContainedFilesPage } from "../utils/path-containment.js";
import { listVisibleMarketplaces } from "./host-marketplaces.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import {
  hostPluginPullUnavailableReason,
  listHostPluginVersions,
  type HostPluginCacheVersion,
} from "./host-plugin-versions.js";
import { resolveExistingResourceFilesystemPath } from "./resource-editor-path.js";
import { resolveInstallRoot } from "./resource-sync.js";

export const CONTAINED_FILES_PAGE_SIZE = 20;

export interface PluginContainedResource {
  type: string;
  name: string;
  path: string;
  relative_path: string;
}

export interface PluginResourceShowExtras {
  install_path: string | null;
  marketplace_url: string | null;
  contained_resources: PluginContainedResource[];
  current_version: string | null;
  advertised_version: string | null;
  available_versions: HostPluginCacheVersion[];
  pull_unavailable_reason: string | null;
}

export type PluginResourceShowOptions = {
  homeRoot?: string;
  harnesstapDir?: string;
  pathHint?: string | null;
  includeContained?: boolean;
  limit?: number;
  offset?: number;
};

export type ContainedResourcePage = {
  contained_resources: PluginContainedResource[];
  has_more: boolean;
};

export function pluginResourceShowExtras(
  resource: Resource,
  options?: PluginResourceShowOptions,
): PluginResourceShowExtras | undefined {
  if (resource.type !== "plugin") {
    return undefined;
  }
  const originRef = resource.origin_ref || resource.name;
  const installPath = options?.homeRoot
    ? resolveInstallRoot(
        originRef,
        options.homeRoot,
        join(options.homeRoot, ".claude", "plugins"),
      )
    : resolveInstallRoot(originRef);
  const marketplaceName =
    (resource.metadata as PluginDependencyMetadata).marketplace_name ||
    parseDependencyRef(originRef).namespace ||
    resource.namespace?.split("#")[0] ||
    "";
  const marketplaceUrl =
    resource.origin_kind === "marketplace_link" && marketplaceName
      ? (listVisibleMarketplaces(
          options?.harnesstapDir ?? getHarnesstapDir(),
          options?.homeRoot,
        ).find((entry) => entry.name === marketplaceName)?.url ?? null)
      : null;
  const versions = listHostPluginVersions(originRef, options?.homeRoot);
  const pull_unavailable_reason = hostPluginPullUnavailableReason(
    originRef,
    options?.homeRoot,
  );
  const current_version =
    versions.current_version ??
    (resource.metadata as PluginDependencyMetadata).resolved_version ??
    null;
  const includeContained = options?.includeContained !== false;
  if (!installPath) {
    return {
      install_path: null,
      marketplace_url: marketplaceUrl,
      contained_resources: [],
      current_version,
      advertised_version: versions.advertised_version,
      available_versions: versions.available_versions,
      pull_unavailable_reason,
    };
  }
  return {
    install_path: installPath,
    marketplace_url: marketplaceUrl,
    contained_resources: includeContained
      ? listContainedPluginFiles(installPath, originRef, resource.id, {
          limit: options?.limit,
          offset: options?.offset,
        }).contained_resources
      : [],
    current_version,
    advertised_version: versions.advertised_version,
    available_versions: versions.available_versions,
    pull_unavailable_reason,
  };
}

export interface PackageResourceShowExtras {
  contained_resources: PluginContainedResource[];
}

/** Nested files for SKILL.md / plugin.json packages that are not plugin-type resources. */
export function packageResourceShowExtras(
  resource: Resource,
  options?: PluginResourceShowOptions,
): PackageResourceShowExtras | undefined {
  if (resource.type === "plugin") {
    return undefined;
  }
  if (options?.includeContained === false) {
    return undefined;
  }
  const page = listPackageContainedFiles(resource, options);
  if (!page || page.contained_resources.length === 0) {
    return undefined;
  }
  return { contained_resources: page.contained_resources };
}

export function listResourceContainedFiles(
  resource: Resource,
  options?: PluginResourceShowOptions,
): ContainedResourcePage {
  if (resource.type === "plugin") {
    const extras = pluginResourceShowExtras(resource, {
      ...options,
      includeContained: false,
    });
    if (!extras?.install_path) {
      return { contained_resources: [], has_more: false };
    }
    return listContainedPluginFiles(
      extras.install_path,
      resource.origin_ref || resource.name,
      resource.id,
      { limit: options?.limit, offset: options?.offset },
    );
  }
  return (
    listPackageContainedFiles(resource, options) ?? {
      contained_resources: [],
      has_more: false,
    }
  );
}

const SKIP_TREE_SEGMENTS = new Set([".git", "node_modules"]);

function listPluginTreeRelativePaths(
  installPath: string,
  options?: { limit?: number; offset?: number },
): { files: string[]; hasMore: boolean } {
  try {
    const page = listContainedFilesPage(installPath, {
      limit: options?.limit,
      offset: options?.offset,
      skipDirNames: SKIP_TREE_SEGMENTS,
    });
    if (options?.limit === undefined && (options?.offset ?? 0) === 0) {
      return {
        files: page.files.slice().sort((left, right) => left.localeCompare(right)),
        hasMore: page.hasMore,
      };
    }
    return page;
  } catch {
    return { files: [], hasMore: false };
  }
}

function inferPackageContainedFileType(relativePath: string): string {
  const base = relativePath.split("/").at(-1)?.toLowerCase() ?? "";
  if (base === "skill.md") {
    return "skill";
  }
  if (base === "plugin.json") {
    return "plugin";
  }
  return inferContainedFileType(relativePath);
}

function listPackageTreeFiles(
  packageDir: string,
  options?: { limit?: number; offset?: number },
): ContainedResourcePage {
  const page = listPluginTreeRelativePaths(packageDir, options);
  return {
    contained_resources: page.files.map((relative_path) => ({
      type: inferPackageContainedFileType(relative_path),
      name: containedFileStem(relative_path),
      path: join(packageDir, ...relative_path.split("/")),
      relative_path,
    })),
    has_more: page.hasMore,
  };
}

function listPackageContainedFiles(
  resource: Resource,
  options?: PluginResourceShowOptions,
): ContainedResourcePage | undefined {
  const filePath = resolveExistingResourceFilesystemPath(resource, options?.pathHint);
  if (!filePath) {
    return undefined;
  }
  const fileName = filePath.split(/[/\\]/).pop() ?? "";
  if (!isPackageEntryFileName(fileName)) {
    return undefined;
  }
  return listPackageTreeFiles(packageDirectoryDisplayPath(filePath), {
    limit: options?.limit,
    offset: options?.offset,
  });
}

function listContainedPluginFiles(
  installPath: string,
  originRef: string,
  pluginResourceId: string,
  options?: { limit?: number; offset?: number },
): ContainedResourcePage {
  const libraryByRelative = new Map<string, Resource>();
  for (const row of listResourcesMatchingOriginRef(originRef)) {
    if (row.type === "plugin" || row.id === pluginResourceId) {
      continue;
    }
    const contained = containedFile(installPath, row.source);
    if (contained) {
      libraryByRelative.set(contained.relative_path, row);
    }
  }

  const treePage = listPluginTreeRelativePaths(installPath, options);
  if (treePage.files.length === 0 && !treePage.hasMore) {
    const fallback = [...libraryByRelative.entries()]
      .map(([relative_path, row]) => {
        const contained = containedFile(installPath, row.source);
        return {
          type: row.type,
          name: row.name,
          path: contained?.path ?? join(installPath, ...relative_path.split("/")),
          relative_path,
        };
      })
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path));
    const start = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    if (limit === undefined) {
      return { contained_resources: fallback.slice(start), has_more: false };
    }
    const end = start + limit;
    return {
      contained_resources: fallback.slice(start, end),
      has_more: end < fallback.length,
    };
  }

  return {
    contained_resources: treePage.files.map((relative_path) => {
      const path = join(installPath, ...relative_path.split("/"));
      const row = libraryByRelative.get(relative_path);
      if (row) {
        return {
          type: row.type,
          name: row.name,
          path,
          relative_path,
        };
      }
      return {
        type: inferContainedFileType(relative_path),
        name: containedFileStem(relative_path),
        path,
        relative_path,
      };
    }),
    has_more: treePage.hasMore,
  };
}

function containedFile(
  installPath: string,
  source: string,
): { path: string; relative_path: string } | null {
  if (!source.trim()) {
    return null;
  }
  const absolute = resolve(installPath, source);
  const root = resolve(installPath);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..")) {
    return null;
  }
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    if (!statSync(absolute).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    path: absolute,
    relative_path: rel.split(sep).join("/"),
  };
}
