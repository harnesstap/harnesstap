import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  listLinkedResources,
  normalizeResourceInput,
  upsertResource,
  type ImportConflictPolicy,
} from "../models/resource.js";
import type { Resource } from "../types.js";
import { scanPluginSource } from "./plugin-source-import.js";
import { resolveHomeRoot } from "../utils/home-root.js";

export interface SyncLinkedResourcesOptions {
  selector?: string;
  policy?: ImportConflictPolicy;
  dryRun?: boolean;
  homeRoot?: string;
  claudePluginsRoot?: string;
}

export interface SyncLinkedResourcesResult {
  checked: number;
  updated: Resource[];
  stale: Array<{ resource: Resource; reason: string }>;
  unchanged: Resource[];
}

function defaultClaudePluginsRoot(homeRoot: string): string {
  return join(homeRoot, ".claude", "plugins");
}

function resolveInstallRoot(
  originRef: string,
  homeRoot: string,
  claudePluginsRoot: string,
): string | undefined {
  const [plugin, marketplace] = originRef.split("@");
  if (!plugin) return undefined;

  const candidates = [
    join(claudePluginsRoot, "cache", marketplace ?? plugin, plugin),
    join(claudePluginsRoot, "cache", plugin, plugin),
    join(claudePluginsRoot, marketplace ?? plugin, plugin),
    join(homeRoot, ".cursor", "plugins", plugin),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

export async function syncLinkedResources(
  options: SyncLinkedResourcesOptions = {},
): Promise<SyncLinkedResourcesResult> {
  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const claudePluginsRoot =
    options.claudePluginsRoot ?? defaultClaudePluginsRoot(homeRoot);
  const policy = options.policy ?? "overwrite";
  const targets = listLinkedResources(options.selector);
  const updated: Resource[] = [];
  const stale: SyncLinkedResourcesResult["stale"] = [];
  const unchanged: Resource[] = [];

  for (const resource of targets) {
    const installRoot = resolveInstallRoot(resource.origin_ref, homeRoot, claudePluginsRoot);
    if (!installRoot) {
      stale.push({ resource, reason: "install path not found" });
      continue;
    }

    const imports = await scanPluginSource(installRoot);
    const match = imports
      .flatMap((entry) => entry.resources)
      .find((candidate) => candidate.type === resource.type && candidate.name === resource.name);

    if (!match) {
      stale.push({ resource, reason: "resource missing from install tree" });
      continue;
    }

    if (options.dryRun) {
      continue;
    }

    const result = upsertResource(
      normalizeResourceInput({
        ...match,
        namespace: resource.namespace,
        origin_kind: "marketplace_link",
        origin_ref: resource.origin_ref,
      }),
      { policy },
    );

    if (result.action === "updated" || result.action === "created") {
      updated.push(result.resource);
    } else if (result.action === "unchanged") {
      unchanged.push(result.resource);
    }
  }

  return {
    checked: targets.length,
    updated,
    stale,
    unchanged,
  };
}
