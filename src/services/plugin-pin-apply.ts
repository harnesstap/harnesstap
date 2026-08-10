import { getDb } from "../db/connection.js";
import {
  ensurePluginResource,
  findPluginResourceByPin,
} from "./layer-composition.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import {
  installPluginPins,
  type InstallPluginPinResult,
  type InstallPluginPinsProgress,
} from "./plugin-install.js";
import { syncPluginResource } from "./resource-sync.js";
import {
  validatePluginPinsAgainstInventory,
  type PluginConstraintPin,
  type PluginValidationIssue,
} from "./plugin-apply-validation.js";
import { materializeUpstreamPluginLayer } from "./upstream-plugin-layer.js";
import { listResources } from "../models/resource.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";
import type { PluginScope } from "../plugins/types.js";
import type { PluginPinMetadata, Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  ensureClaudeMarketplacesFromConfig,
} from "./claude-marketplace-bootstrap.js";
import type { ClaudeLayerConfig } from "../types.js";

export type { PluginConstraintPin, PluginValidationIssue };

export interface SyncPluginPinsForApplyProgress extends InstallPluginPinsProgress {
  onSyncStart?: (ref: string) => void;
  onSyncComplete?: (ref: string) => void;
}

export interface SyncPluginPinsForApplyOptions {
  pins: PluginConstraintPin[];
  /** When true, refresh every pinned plugin (--sync-plugins). */
  syncAll?: boolean;
  homeRoot?: string;
  projectRoot: string;
  scope?: PluginScope;
  installPlatformId?: string;
  /** When true, stamp exact constraints without a local install tree. */
  ignoreMissingInstall?: boolean;
  progress?: SyncPluginPinsForApplyProgress;
}

export interface SyncPluginPinsForApplyResult {
  installs: InstallPluginPinResult[];
  syncedResourceCount: number;
  unresolvedPins: string[];
}

export interface PreparePluginPinsForApplyOptions {
  pins: PluginConstraintPin[];
  baseResources: Resource[];
  projectRoot: string;
  claudeConfig?: ClaudeLayerConfig;
  /** When true, skip install/sync and only expand resources + validate pins. */
  skipSync?: boolean;
  syncAll?: boolean;
  homeRoot?: string;
  scope?: PluginScope;
  installPlatformId?: string;
  ignoreMissingInstall?: boolean;
  progress?: SyncPluginPinsForApplyProgress;
}

export interface PreparePluginPinsForApplyResult extends SyncPluginPinsForApplyResult {
  applyResources: Resource[];
  extraMaterialized: number;
  validationIssues: PluginValidationIssue[];
}

const materialTypes = new Set<string>(MATERIAL_RESOURCE_TYPES);

function materialResourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function stampResolvedVersionFromExactConstraint(
  resource: Resource,
  constraint: string,
): Resource | null {
  try {
    const parsed = parseVersionConstraint(constraint);
    if (parsed.kind !== "exact") {
      return null;
    }

    const metadata: PluginPinMetadata = {
      ...(resource.metadata as PluginPinMetadata),
      resolved_version: parsed.version,
      sync_status: "synced",
    };
    const updatedAt = new Date().toISOString();
    getDb()
      .prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(metadata), updatedAt, resource.id);

    return { ...resource, metadata, updated_at: updatedAt };
  } catch {
    return null;
  }
}

export async function syncPluginPinsForApply(
  options: SyncPluginPinsForApplyOptions,
): Promise<SyncPluginPinsForApplyResult> {
  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const scope = options.scope ?? "user";
  const pinsToInstall = options.pins.filter((pin) => pin.version_constraint);

  const installs = await installPluginPins(pinsToInstall, {
    homeRoot,
    projectRoot: options.projectRoot,
    scope,
    installPlatformId: options.installPlatformId,
    progress: options.progress,
  });

  let syncedResourceCount = 0;
  const unresolvedPins: string[] = [];

  for (const pin of options.pins) {
    if (!pin.version_constraint) {
      continue;
    }

    const selector = pin.ref.includes(":") ? pin.ref : `plugin_pin:${pin.ref}`;
    const constraint =
      pin.version_constraint === "latest" || pin.version_constraint === "*"
        ? undefined
        : pin.version_constraint;

    let resource =
      findPluginResourceByPin(pin.ref, pin.version_constraint) ??
      ensurePluginResource(selector, { versionConstraint: constraint });

    const metadata = (resource.metadata ?? {}) as PluginPinMetadata;
    const needsSync = options.syncAll || !metadata.resolved_version;
    if (!needsSync) {
      // Already resolved — still ensure the upstream layer exists so the
      // graph can treat the install as an ordinary node without a re-sync.
      if (metadata.resolved_version) {
        const parsed = parseDependencyRef(pin.ref);
        materializeUpstreamPluginLayer({
          ref: pin.ref,
          name: parsed.name,
          version: metadata.resolved_version,
        });
      }
      continue;
    }

    options.progress?.onSyncStart?.(pin.ref);
    const syncResult = await syncPluginResource(resource, {
      policy: "overwrite",
      onConflict: "overwrite",
      homeRoot,
    });
    syncedResourceCount += syncResult.updated.length;
    options.progress?.onSyncComplete?.(pin.ref);

    resource =
      findPluginResourceByPin(pin.ref, pin.version_constraint) ?? resource;
    const syncedMetadata = (resource.metadata ?? {}) as PluginPinMetadata;
    const parsed = parseDependencyRef(pin.ref);
    if (syncedMetadata.resolved_version) {
      materializeUpstreamPluginLayer({
        ref: pin.ref,
        name: parsed.name,
        version: syncedMetadata.resolved_version,
      });
      continue;
    }

    if (options.ignoreMissingInstall) {
      const stamped = stampResolvedVersionFromExactConstraint(
        resource,
        pin.version_constraint,
      );
      if (stamped) {
        const stampedMetadata = (stamped.metadata ?? {}) as PluginPinMetadata;
        if (stampedMetadata.resolved_version) {
          materializeUpstreamPluginLayer({
            ref: pin.ref,
            name: parsed.name,
            version: stampedMetadata.resolved_version,
          });
        }
      }
      continue;
    }

    unresolvedPins.push(pin.ref);
  }

  return { installs, syncedResourceCount, unresolvedPins };
}

/**
 * Collect marketplace-linked material resources imported from pinned plugin
 * install trees.
 *
 * @deprecated Resolution owns the resource set via upstream layers. Prefer
 * materializeUpstreamPluginLayer + resolveComposition. Remove in Stage 3.
 */
export function expandPluginPinMaterialResources(
  pins: PluginConstraintPin[],
  baseResources: Resource[] = [],
): Resource[] {
  if (pins.length === 0) {
    return baseResources;
  }

  const pinRefs = new Set(pins.map((pin) => pin.ref));
  const order: string[] = [];
  const byKey = new Map<string, Resource>();

  for (const resource of baseResources) {
    const key = materialResourceKey(resource);
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, resource);
  }

  for (const resource of listResources({ origin_kind: "marketplace_link" })) {
    if (!resource.origin_ref || !pinRefs.has(resource.origin_ref)) {
      continue;
    }
    if (!materialTypes.has(resource.type)) {
      continue;
    }
    const key = materialResourceKey(resource);
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, resource);
  }

  return order
    .map((key) => byKey.get(key))
    .filter((resource): resource is Resource => resource !== undefined);
}

/**
 * @deprecated Resolution owns the resource set via upstream layers. Remove in Stage 3.
 */
export function countPluginPinMaterialResources(
  pins: PluginConstraintPin[],
  baseResources: Resource[] = [],
): number {
  const expanded = expandPluginPinMaterialResources(pins, baseResources);
  return Math.max(0, expanded.length - baseResources.length);
}

export async function preparePluginPinsForApply(
  options: PreparePluginPinsForApplyOptions,
): Promise<PreparePluginPinsForApplyResult> {
  let syncResult: SyncPluginPinsForApplyResult = {
    installs: [],
    syncedResourceCount: 0,
    unresolvedPins: [],
  };

  if (!options.skipSync && options.claudeConfig) {
    ensureClaudeMarketplacesFromConfig(options.claudeConfig, {
      homeRoot: options.homeRoot ?? resolveHomeRoot(),
      projectRoot: options.projectRoot,
    });
  }

  if (!options.skipSync && options.pins.length > 0) {
    syncResult = await syncPluginPinsForApply({
      pins: options.pins,
      syncAll: options.syncAll,
      homeRoot: options.homeRoot,
      projectRoot: options.projectRoot,
      scope: options.scope,
      installPlatformId: options.installPlatformId,
      ignoreMissingInstall: options.ignoreMissingInstall,
      progress: options.progress,
    });
  }

  // Resolution owns the resource set. Install/sync still materializes upstream
  // layers; expandPluginPinMaterialResources is no longer consulted here.
  const validationIssues = validatePluginPinsAgainstInventory(options.pins);

  return {
    ...syncResult,
    applyResources: options.baseResources,
    extraMaterialized: 0,
    validationIssues,
  };
}
