import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/connection.js";
import {
  listLinkedResources,
  listResources,
  normalizeResourceInput,
  resolveResource,
  upsertResource,
  type ImportConflictPolicy,
} from "../models/resource.js";
import { getPluginByName } from "../models/plugin-model.js";
import type { PluginDependencyMetadata, PluginPinMetadata, Resource } from "../types.js";
import {
  readPluginVersionFromInstallRoot,
  scanPluginSource,
} from "./plugin-source-import.js";
import { getInstalledPluginInstallPath } from "../plugins/claude-installed.js";
import { resolveClaudeInstallRefCandidates } from "../plugins/claude-plugin-ref.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { formatPluginRef } from "./plugin-composition.js";
import { assertSyncable } from "./plugin-origin.js";
import { parseDependencyRef } from "./plugin-dependency.js";

export interface SyncLinkedResourcesOptions {
  selector?: string;
  policy?: ImportConflictPolicy;
  onConflict?: "overwrite" | "ignore" | "fail";
  dryRun?: boolean;
  force?: boolean;
  homeRoot?: string;
  claudePluginsRoot?: string;
}

export interface SyncLinkedResourcesResult {
  checked: number;
  updated: Resource[];
  stale: Array<{ resource: Resource; reason: string }>;
  unchanged: Resource[];
  skipped: Resource[];
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

  const installRefCandidates = resolveClaudeInstallRefCandidates(originRef, homeRoot);
  const installedPath = getInstalledPluginInstallPath(
    homeRoot,
    originRef,
    installRefCandidates,
  );
  const cacheCandidates = installRefCandidates.flatMap((ref) => {
    const [, resolvedMarketplace] = ref.split("@");
    if (!resolvedMarketplace) {
      return [];
    }
    return [join(claudePluginsRoot, "cache", resolvedMarketplace, plugin)];
  });
  const candidates = [
    ...(installedPath ? [installedPath] : []),
    ...cacheCandidates,
    join(claudePluginsRoot, "cache", marketplace ?? plugin, plugin),
    join(claudePluginsRoot, "CACHE", plugin),
    join(claudePluginsRoot, "cache", plugin, plugin),
    join(claudePluginsRoot, marketplace ?? plugin, plugin),
    join(homeRoot, ".cursor", "plugins", plugin),
    join(homeRoot, ".cursor", "plugins", "cache", marketplace ?? plugin, plugin),
    join(homeRoot, ".agents", "plugins", plugin),
  ];

  if (originRef.startsWith("./") || originRef.startsWith("../")) {
    candidates.unshift(join(process.cwd(), originRef));
  }

  return candidates.find((candidate) => existsSync(candidate));
}

function isPinned(resource: Resource): boolean {
  const metadata = resource.metadata as { sync_status?: string };
  return metadata.sync_status === "pinned";
}

function resolveConflictPolicy(
  options: SyncLinkedResourcesOptions,
): "overwrite" | "ignore" | "fail" {
  if (options.onConflict) {
    return options.onConflict;
  }
  if (options.policy === "skip") {
    return "ignore";
  }
  if (options.policy === "overwrite") {
    return "overwrite";
  }
  return "fail";
}

/**
 * Sync is about refreshing an upstream/catalog install tree — not about
 * consumer plugins that merely attach the dependency. Local composition deps
 * gate on the named plugin's origin (authored → refuse).
 */
function assertPluginResourceSyncable(pluginResource: Resource): void {
  const metadata = (pluginResource.metadata ?? {}) as PluginDependencyMetadata;
  const sourceKind =
    metadata.source_kind ??
    parseDependencyRef(pluginResource.origin_ref || pluginResource.name).source_kind;
  if (sourceKind !== "local") {
    return;
  }
  const plugin =
    getPluginByName(pluginResource.name) ??
    (pluginResource.origin_ref
      ? getPluginByName(pluginResource.origin_ref)
      : undefined);
  if (plugin) {
    assertSyncable(plugin.id);
  }
}

export async function syncPluginResource(
  pluginResource: Resource,
  options: SyncLinkedResourcesOptions = {},
): Promise<SyncLinkedResourcesResult> {
  assertPluginResourceSyncable(pluginResource);

  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const claudePluginsRoot =
    options.claudePluginsRoot ?? defaultClaudePluginsRoot(homeRoot);
  const conflictPolicy = resolveConflictPolicy(options);
  const updated: Resource[] = [];
  const stale: SyncLinkedResourcesResult["stale"] = [];
  const unchanged: Resource[] = [];
  const skipped: Resource[] = [];

  const originRef = pluginResource.origin_ref || formatPluginRef(pluginResource);
  const installRoot = resolveInstallRoot(originRef, homeRoot, claudePluginsRoot);
  if (!installRoot) {
    stale.push({
      resource: pluginResource,
      reason: "install path not found; install plugin via harness or sync after marketplace fetch",
    });
    return { checked: 1, updated, stale, unchanged, skipped };
  }

  let scan: Awaited<ReturnType<typeof scanPluginSource>>[number] | undefined;
  try {
    const imports = await scanPluginSource(installRoot);
    scan = imports[0];
  } catch {
    scan = undefined;
  }

  if (!scan) {
    const manifestVersion = readPluginVersionFromInstallRoot(installRoot);
    if (!manifestVersion) {
      stale.push({ resource: pluginResource, reason: "plugin tree is empty" });
      return { checked: 1, updated, stale, unchanged, skipped };
    }

    if (!options.dryRun) {
      const metadata: PluginPinMetadata = {
        ...(pluginResource.metadata as PluginPinMetadata),
        resolved_version: manifestVersion,
        sync_status: "synced",
        manifests: {
          ...(pluginResource.metadata as PluginPinMetadata).manifests,
        },
      };
      const db = getDb();
      db.prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(metadata),
        new Date().toISOString(),
        pluginResource.id,
      );
      updated.push({ ...pluginResource, metadata });
    }

    return { checked: 1, updated, stale, unchanged, skipped };
  }

  if (!options.dryRun) {
    const metadata: PluginPinMetadata = {
      ...(pluginResource.metadata as PluginPinMetadata),
      resolved_version: scan.plugin_version,
      sync_status: "synced",
      manifests: {
        ...(pluginResource.metadata as PluginPinMetadata).manifests,
      },
    };
    const db = getDb();
    db.prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(metadata),
      new Date().toISOString(),
      pluginResource.id,
    );
  }

  let checked = 1;
  for (const candidate of scan.resources) {
    checked += 1;
    const namespace = pluginResource.name;
    const existing = listResources({
      type: candidate.type,
      includeComposition: true,
    }).find(
      (row) =>
        row.name === candidate.name &&
        row.namespace === namespace &&
        row.origin_ref === originRef,
    );

    if (existing && isPinned(existing) && !options.force) {
      skipped.push(existing);
      continue;
    }

    if (options.dryRun) {
      continue;
    }

    const policy: ImportConflictPolicy =
      conflictPolicy === "overwrite"
        ? "overwrite"
        : conflictPolicy === "ignore"
          ? "skip"
          : "fail";

    const result = upsertResource(
      normalizeResourceInput({
        ...candidate,
        namespace,
        origin_kind: "marketplace_link",
        origin_ref: originRef,
      }),
      { policy },
    );

    if (result.action === "updated" || result.action === "created") {
      updated.push(result.resource);
    } else if (result.action === "unchanged") {
      unchanged.push(result.resource);
    } else if (result.action === "skipped") {
      skipped.push(result.existing);
    }
  }

  return { checked, updated, stale, unchanged, skipped };
}

export async function syncLinkedResources(
  options: SyncLinkedResourcesOptions = {},
): Promise<SyncLinkedResourcesResult> {
  if (options.selector) {
    const resolved = resolveResource(options.selector, { mode: "compose" });
    if (resolved.status === "found" && resolved.resource.type === "plugin") {
      return syncPluginResource(resolved.resource, options);
    }
  }

  const pluginTargets = options.selector
    ? []
    : listResources({ type: "plugin", includeComposition: true });

  const linkedTargets = listLinkedResources(options.selector).filter(
    (resource) => resource.type !== "plugin",
  );

  const aggregated: SyncLinkedResourcesResult = {
    checked: 0,
    updated: [],
    stale: [],
    unchanged: [],
    skipped: [],
  };

  for (const pluginResource of pluginTargets) {
    const result = await syncPluginResource(pluginResource, options);
    aggregated.checked += result.checked;
    aggregated.updated.push(...result.updated);
    aggregated.stale.push(...result.stale);
    aggregated.unchanged.push(...result.unchanged);
    aggregated.skipped.push(...result.skipped);
  }

  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const claudePluginsRoot =
    options.claudePluginsRoot ?? defaultClaudePluginsRoot(homeRoot);
  const policy = options.policy ?? "overwrite";

  for (const resource of linkedTargets) {
    aggregated.checked += 1;
    const installRoot = resolveInstallRoot(resource.origin_ref, homeRoot, claudePluginsRoot);
    if (!installRoot) {
      aggregated.stale.push({ resource, reason: "install path not found" });
      continue;
    }

    const imports = await scanPluginSource(installRoot);
    const match = imports
      .flatMap((entry) => entry.resources)
      .find((candidate) => candidate.type === resource.type && candidate.name === resource.name);

    if (!match) {
      aggregated.stale.push({ resource, reason: "resource missing from install tree" });
      continue;
    }

    if (isPinned(resource) && !options.force) {
      aggregated.skipped.push(resource);
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
      aggregated.updated.push(result.resource);
    } else if (result.action === "unchanged") {
      aggregated.unchanged.push(result.resource);
    } else if (result.action === "skipped") {
      aggregated.skipped.push(result.existing);
    }
  }

  return aggregated;
}
