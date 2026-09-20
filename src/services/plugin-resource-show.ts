import { existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { listResources } from "../models/resource.js";
import type { PluginDependencyMetadata, Resource } from "../types.js";
import {
  containedFileStem,
  inferContainedFileType,
} from "../ui/resource-display.js";
import { listContainedFiles } from "../utils/path-containment.js";
import { listMarketplaces } from "./marketplace-registry.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import { resolveInstallRoot } from "./resource-sync.js";

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
}

export function pluginResourceShowExtras(
  resource: Resource,
  options?: { homeRoot?: string; harnesstapDir?: string },
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
      ? (listMarketplaces(options?.harnesstapDir ?? getHarnesstapDir()).find(
          (entry) => entry.name === marketplaceName,
        )?.url ?? null)
      : null;
  if (!installPath) {
    return {
      install_path: null,
      marketplace_url: marketplaceUrl,
      contained_resources: [],
    };
  }
  return {
    install_path: installPath,
    marketplace_url: marketplaceUrl,
    contained_resources: listContainedPluginFiles(installPath, originRef, resource.id),
  };
}

const SKIP_TREE_SEGMENTS = new Set([".git", "node_modules"]);

function listPluginTreeRelativePaths(installPath: string): string[] {
  try {
    return listContainedFiles(installPath).filter(
      (relativePath) => !relativePath.split("/").some((part) => SKIP_TREE_SEGMENTS.has(part)),
    );
  } catch {
    return [];
  }
}

function listContainedPluginFiles(
  installPath: string,
  originRef: string,
  pluginResourceId: string,
): PluginContainedResource[] {
  const libraryByRelative = new Map<string, Resource>();
  for (const row of listResources({ includeComposition: true })) {
    if (row.origin_ref !== originRef || row.type === "plugin" || row.id === pluginResourceId) {
      continue;
    }
    const contained = containedFile(installPath, row.source);
    if (contained) {
      libraryByRelative.set(contained.relative_path, row);
    }
  }

  const treePaths = listPluginTreeRelativePaths(installPath);
  if (treePaths.length === 0) {
    return [...libraryByRelative.entries()]
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
  }

  return treePaths
    .map((relative_path) => {
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
    })
    .sort((left, right) => left.relative_path.localeCompare(right.relative_path));
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
