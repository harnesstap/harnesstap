import { traceSpan } from "./status-trace.js";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import {
  ensurePluginResource,
  findPluginResourceByPin,
} from "./plugin-composition.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import {
  listDependencies,
  parseDependencyRef,
} from "./plugin-dependency.js";
import {
  installPluginPins,
  isPinnedGitConstraint,
  type InstallPluginPinResult,
  type InstallPluginPinsProgress,
} from "./plugin-install.js";
import { syncPluginResource } from "./resource-sync.js";
import {
  validatePluginPinsAgainstInventory,
  type PluginConstraintPin,
  type PluginValidationIssue,
} from "./plugin-apply-validation.js";
import { materializeUpstreamPlugin } from "./upstream-plugin.js";
import { getResource, listResources } from "../models/resource.js";
import {
  MATERIAL_RESOURCE_TYPES,
  type ClaudePluginConfig,
  type DependencySourceKind,
  type PluginPinMetadata,
  type Resource,
} from "../types.js";
import type { PluginScope } from "../plugins/types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  ensureClaudeMarketplacesFromConfig,
} from "./claude-marketplace-bootstrap.js";
import {
  ensureCursorMarketplaces,
  selectCursorMarketplacesToEnsure,
} from "./cursor-marketplace-bootstrap.js";
import { listMarketplaces } from "./marketplace-registry.js";
import {
  installPinnedPluginsHint,
  installPinnedPluginsNeedsYes,
} from "../copy/cli.js";

export type { PluginConstraintPin, PluginValidationIssue };

/** Dependency sources that need install/sync before composition can see them. */
const PREPARE_BEFORE_RESOLVE_SOURCES = new Set<DependencySourceKind>([
  "marketplace",
  "git",
]);

/**
 * Collect marketplace/git pins attached directly to the given plugins.
 * Used to materialize upstream plugins before the first composition resolve.
 */
export function collectPluginPinsForPrepare(
  pluginIds: string[],
): PluginConstraintPin[] {
  const pins = new Map<string, PluginConstraintPin>();
  for (const pluginId of pluginIds) {
    for (const dependency of listDependencies(pluginId)) {
      if (!PREPARE_BEFORE_RESOLVE_SOURCES.has(dependency.source_kind)) {
        continue;
      }
      pins.set(dependency.ref, {
        ref: dependency.ref,
        version_constraint: dependency.version_constraint,
      });
    }
  }
  return [...pins.values()];
}

export interface SyncPluginPinsForApplyProgress extends InstallPluginPinsProgress {
  onSyncStart?: (ref: string) => void;
  onSyncComplete?: (ref: string) => void;
}

export class PinnedPluginInstallConsentError extends Error {
  readonly hint: string;

  constructor(profileName?: string) {
    super(installPinnedPluginsNeedsYes());
    this.name = "PinnedPluginInstallConsentError";
    this.hint = installPinnedPluginsHint(profileName);
  }
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
  yes?: boolean;
  interactive?: boolean;
  profileName?: string;
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
  claudeConfig?: ClaudePluginConfig;
  /** When true, skip install/sync and only expand resources + validate pins. */
  skipSync?: boolean;
  syncAll?: boolean;
  homeRoot?: string;
  scope?: PluginScope;
  installPlatformId?: string;
  ignoreMissingInstall?: boolean;
  yes?: boolean;
  interactive?: boolean;
  profileName?: string;
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

/**
 * A marketplace or git dependency with an empty constraint is unpinned, the
 * same as `*` or `latest`: it still installs (git tracks the default branch
 * HEAD, and doctor warns). Other sources need no install step.
 */
function installsWhenUnpinned(ref: string): boolean {
  const sourceKind = parseDependencyRef(ref).source_kind;
  return sourceKind === "marketplace" || sourceKind === "git";
}

function effectivePinConstraint(constraint: string | undefined): string {
  const trimmed = constraint?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "latest";
}

export async function syncPluginPinsForApply(
  options: SyncPluginPinsForApplyOptions,
): Promise<SyncPluginPinsForApplyResult> {
  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const scope = options.scope ?? "user";
  const pinsToInstall = options.pins
    .filter((pin) => pin.version_constraint.trim() || installsWhenUnpinned(pin.ref))
    .map((pin) => ({
      ...pin,
      version_constraint: effectivePinConstraint(pin.version_constraint),
    }));

  if (
    pinsToInstall.length > 0
    && !options.ignoreMissingInstall
    && options.interactive === false
    && !options.yes
  ) {
    throw new PinnedPluginInstallConsentError(options.profileName);
  }

  // --ignore-plugin-versions stamps exact constraints locally; skip marketplace
  // install attempts that can hang or fail without a real host install.
  const installs =
    options.ignoreMissingInstall && !options.syncAll
      ? []
      : await installPluginPins(pinsToInstall, {
          homeRoot,
          projectRoot: options.projectRoot,
          scope,
          installPlatformId: options.installPlatformId,
          progress: options.progress,
        });

  // A git dependency pinned to a commit, tag, branch or tag range that could
  // not be fetched stops the apply with the git error (#500), instead of a
  // later "no local version" message.
  for (const install of installs) {
    if (install.status !== "failed") continue;
    const pin = pinsToInstall.find((candidate) => candidate.ref === install.ref);
    if (!pin || parseDependencyRef(pin.ref).source_kind !== "git") continue;
    if (!isPinnedGitConstraint(pin.version_constraint)) continue;
    throw new Error(`Could not fetch git dependency ${pin.ref} at ${pin.version_constraint}: ${install.message}`);
  }

  let syncedResourceCount = 0;
  const unresolvedPins: string[] = [];

  for (const pin of options.pins) {
    if (!pin.version_constraint.trim() && !installsWhenUnpinned(pin.ref)) {
      continue;
    }
    const versionConstraint = effectivePinConstraint(pin.version_constraint);

    const selector = pin.ref.includes(":") ? pin.ref : `plugin_pin:${pin.ref}`;
    const constraint =
      versionConstraint === "latest" || versionConstraint === "*"
        ? undefined
        : versionConstraint;

    let resource = traceSpan(
      "dry-run.plugin-pins.lookup",
      () =>
        findPluginResourceByPin(pin.ref, pin.version_constraint) ??
        ensurePluginResource(selector, { versionConstraint: constraint }),
      pin.ref,
    );

    const metadata = (resource.metadata ?? {}) as PluginPinMetadata;
    const needsSync = options.syncAll || !metadata.resolved_version;
    if (!needsSync) {
      // Already resolved: still ensure the upstream plugin exists so the
      // graph can treat the install as an ordinary node without a re-sync.
      if (metadata.resolved_version) {
        const parsed = parseDependencyRef(pin.ref);
        const version = metadata.resolved_version;
        traceSpan(
          "dry-run.plugin-pins.upstream",
          () => materializeUpstreamPlugin({ ref: pin.ref, name: parsed.name, version }),
          pin.ref,
        );
      }
      continue;
    }

    // --ignore-plugin-versions: stamp exact constraints into upstream stubs
    // without contacting marketplaces (avoids hangs / missing installs).
    if (options.ignoreMissingInstall && !options.syncAll) {
      const stamped = stampResolvedVersionFromExactConstraint(
        resource,
        pin.version_constraint,
      );
      if (stamped) {
        const stampedMetadata = (stamped.metadata ?? {}) as PluginPinMetadata;
        const parsed = parseDependencyRef(pin.ref);
        if (stampedMetadata.resolved_version) {
          materializeUpstreamPlugin({
            ref: pin.ref,
            name: parsed.name,
            version: stampedMetadata.resolved_version,
          });
        }
        continue;
      }
    }

    options.progress?.onSyncStart?.(pin.ref);
    const syncTarget = resource;
    const syncResult = await traceSpan(
      "dry-run.plugin-pins.sync",
      () => syncPluginResource(syncTarget, { policy: "overwrite", onConflict: "overwrite", homeRoot }),
      pin.ref,
    );
    syncedResourceCount += syncResult.updated.length;
    options.progress?.onSyncComplete?.(pin.ref);

    resource =
      findPluginResourceByPin(pin.ref, pin.version_constraint) ??
      findPluginResourceByPin(pin.ref) ??
      (resource.id ? getResource(resource.id) : undefined) ??
      resource;
    const syncedMetadata = (resource.metadata ?? {}) as PluginPinMetadata;
    const parsed = parseDependencyRef(pin.ref);
    if (syncedMetadata.resolved_version) {
      materializeUpstreamPlugin({
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
          materializeUpstreamPlugin({
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
 * @deprecated Resolution owns the resource set via upstream plugins. Prefer
 * materializeUpstreamPlugin + resolveComposition. Remove in Stage 3.
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
 * @deprecated Resolution owns the resource set via upstream plugins. Remove in Stage 3.
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
    await ensureClaudeMarketplacesFromConfig(options.claudeConfig, {
      homeRoot: options.homeRoot ?? resolveHomeRoot(),
      projectRoot: options.projectRoot,
    });
  }

  if (!options.skipSync && options.pins.length > 0) {
    const cursorEntries = selectCursorMarketplacesToEnsure(
      listMarketplaces(getHarnesstapDir()),
      options.pins.map((pin) => pin.ref),
    );
    await ensureCursorMarketplaces(cursorEntries, {
      homeRoot: options.homeRoot ?? resolveHomeRoot(),
      projectRoot: options.projectRoot,
    });

    syncResult = await syncPluginPinsForApply({
      pins: options.pins,
      syncAll: options.syncAll,
      homeRoot: options.homeRoot,
      projectRoot: options.projectRoot,
      scope: options.scope,
      installPlatformId: options.installPlatformId,
      ignoreMissingInstall: options.ignoreMissingInstall,
      yes: options.yes,
      interactive: options.interactive,
      profileName: options.profileName,
      progress: options.progress,
    });
  }

  // Resolution owns the resource set. Install/sync still materializes upstream
  // plugins; expandPluginPinMaterialResources is no longer consulted here.
  const validationIssues = validatePluginPinsAgainstInventory(options.pins);

  return {
    ...syncResult,
    applyResources: options.baseResources,
    extraMaterialized: 0,
    validationIssues,
  };
}
