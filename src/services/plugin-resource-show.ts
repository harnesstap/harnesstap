import { existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { listResources } from "../models/resource.js";
import type { PluginDependencyMetadata, Resource } from "../types.js";
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
  const contained_resources = listResources({ includeComposition: true })
    .filter(
      (row) => row.origin_ref === originRef && row.type !== "plugin" && row.id !== resource.id,
    )
    .flatMap((row) => {
      const contained = containedFile(installPath, row.source);
      if (!contained) {
        return [];
      }
      return [
        {
          type: row.type,
          name: row.name,
          path: contained.path,
          relative_path: contained.relative_path,
        },
      ];
    });
  return {
    install_path: installPath,
    marketplace_url: marketplaceUrl,
    contained_resources,
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
