import { getDb } from "../db/connection.js";
import {
  ensurePluginResource,
  findPluginResourceByPin,
} from "./composition-resource.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import {
  installPluginPins,
  type InstallPluginPinResult,
  type InstallPluginPinsProgress,
} from "./plugin-install.js";
import { syncPluginResource } from "./resource-sync.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";
import type { PluginScope } from "../plugins/types.js";
import type { PluginResourceMetadata, Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";

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

function stampResolvedVersionFromExactConstraint(
  resource: Resource,
  constraint: string,
): Resource | null {
  try {
    const parsed = parseVersionConstraint(constraint);
    if (parsed.kind !== "exact") {
      return null;
    }

    const metadata: PluginResourceMetadata = {
      ...(resource.metadata as PluginResourceMetadata),
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

    const selector = pin.ref.includes(":") ? pin.ref : `plugin:${pin.ref}`;
    const constraint =
      pin.version_constraint === "latest" || pin.version_constraint === "*"
        ? undefined
        : pin.version_constraint;

    let resource =
      findPluginResourceByPin(pin.ref, pin.version_constraint) ??
      ensurePluginResource(selector, { versionConstraint: constraint });

    const metadata = (resource.metadata ?? {}) as PluginResourceMetadata;
    const needsSync = options.syncAll || !metadata.resolved_version;
    if (!needsSync) {
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
    const syncedMetadata = (resource.metadata ?? {}) as PluginResourceMetadata;
    if (syncedMetadata.resolved_version) {
      continue;
    }

    if (options.ignoreMissingInstall) {
      stampResolvedVersionFromExactConstraint(resource, pin.version_constraint);
      continue;
    }

    unresolvedPins.push(pin.ref);
  }

  return { installs, syncedResourceCount, unresolvedPins };
}
