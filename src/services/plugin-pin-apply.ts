import { assertNoMarketplacePluginNameCollision } from "./upstream-plugin.js";
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
import { hostPluginPackageDir } from "./package-cache/paths.js";
import { harnesstapDirForHomeRoot } from "../db/connection.js";
import { parsePluginRef } from "../plugins/claude-installed.js";
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
  registerDeclaredMarketplaces,
} from "./claude-marketplace-bootstrap.js";
import {
  ensureCursorMarketplaces,
  selectCursorMarketplacesToEnsure,
} from "./cursor-marketplace-bootstrap.js";
import { listMarketplaces } from "./marketplace-registry.js";
import { planMarketplacePinVersion } from "./marketplace-pin-cache.js";
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
  /** Dry-run: a pin that is not installed yet and would install at `version`. */
  onPlanned?: (planned: PlannedPluginInstall) => void;
}

/** A dependency `apply --dry-run` would install, and the version it would take. */
export interface PlannedPluginInstall {
  ref: string;
  name: string;
  version: string;
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
  /**
   * With ignoreMissingInstall, still install pins whose constraint is not exact
   * (`*`, ranges, latest): there is no version to stamp, so skipping the
   * install leaves them unresolvable (--ignore-plugin-versions).
   */
  installInexactPins?: boolean;
  /**
   * Dry-run: install nothing and record no resolved version. A pin that is
   * not installed yet only gets the graph node the resolver needs, at the
   * version an install would take (read from the marketplace catalog for
   * `*`, ranges and latest), and is reported in `planned`.
   */
  planOnly?: boolean;
  yes?: boolean;
  interactive?: boolean;
  profileName?: string;
  progress?: SyncPluginPinsForApplyProgress;
}

export interface SyncPluginPinsForApplyResult {
  installs: InstallPluginPinResult[];
  syncedResourceCount: number;
  unresolvedPins: string[];
  /** Dry-run only: pins a real apply would install. */
  planned?: PlannedPluginInstall[];
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
  installInexactPins?: boolean;
  /** Dry-run: see SyncPluginPinsForApplyOptions.planOnly. Also leaves host marketplaces alone. */
  planOnly?: boolean;
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

function recordResolvedVersion(resource: Resource, version: string): void {
  const metadata: PluginPinMetadata = {
    ...(resource.metadata as PluginPinMetadata),
    resolved_version: version,
    sync_status: "synced",
  };
  getDb()
    .prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(metadata), new Date().toISOString(), resource.id);
}

function isExactConstraint(constraint: string): boolean {
  try {
    return parseVersionConstraint(constraint).kind === "exact";
  } catch {
    return false;
  }
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
  const planOnly = Boolean(options.planOnly);
  const ignoreMissingInstall = Boolean(options.ignoreMissingInstall) || planOnly;
  const syncAll = Boolean(options.syncAll) && !planOnly;
  const planned: PlannedPluginInstall[] = [];
  const pinsToInstall = options.pins
    .filter((pin) => pin.version_constraint.trim() || installsWhenUnpinned(pin.ref))
    .map((pin) => ({
      ...pin,
      version_constraint: effectivePinConstraint(pin.version_constraint),
    }));

  if (
    pinsToInstall.length > 0
    && !ignoreMissingInstall
    && options.interactive === false
    && !options.yes
  ) {
    throw new PinnedPluginInstallConsentError(options.profileName);
  }

  // Refuse a marketplace plugin whose name another marketplace's plugin
  // already holds before installing it, so the refusal leaves no host cache
  // folder behind.
  if (!ignoreMissingInstall) {
    for (const pin of pinsToInstall) {
      if (parseDependencyRef(pin.ref).source_kind === "marketplace") {
        assertNoMarketplacePluginNameCollision(pin.ref);
      }
    }
  }

  // --ignore-plugin-versions stamps exact constraints locally; skip marketplace
  // install attempts that can hang or fail without a real host install. A pin
  // with no exact version to stamp is still installed, or it never resolves.
  const skipInstalls = ignoreMissingInstall && !syncAll;
  const pinsToInstallNow = !skipInstalls
    ? pinsToInstall
    : options.installInexactPins && !planOnly
      ? pinsToInstall.filter((pin) => !isExactConstraint(pin.version_constraint))
      : [];
  const installs = pinsToInstallNow.length === 0
    ? []
    : await installPluginPins(pinsToInstallNow, {
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
    // A git dependency is fetched straight into the library as an upstream
    // plugin, so there is no host install for a sync to read. Record the
    // version the fetch imported instead of reporting it as not installed.
    if (parseDependencyRef(pin.ref).source_kind === "git") {
      const fetchedVersion = installs.find(
        (install) =>
          install.ref === pin.ref
          && (install.status === "installed" || install.status === "already_installed"),
      )?.version;
      if (fetchedVersion) {
        if (metadata.resolved_version !== fetchedVersion || metadata.sync_status !== "synced") {
          recordResolvedVersion(resource, fetchedVersion);
        }
        continue;
      }
    }
    // An unpinned or range dependency follows the version the install just
    // cached (after `ht plugin update` bumped it), instead of the one an
    // earlier apply resolved.
    const installedVersion = installs.find(
      (install) => install.ref === pin.ref && install.status === "installed",
    )?.version;
    const movedOn = Boolean(
      installedVersion
      && metadata.resolved_version
      && installedVersion !== metadata.resolved_version,
    );
    const needsSync = syncAll || !metadata.resolved_version || movedOn;
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

    // Dry-run: an exact pin names its version, so plan it without recording
    // it. Stamping it would make the next real apply skip the sync and apply
    // the plugin with no resources.
    const exactVersion = planOnly ? exactConstraintVersion(pin.version_constraint) : null;
    if (exactVersion) {
      planInstall(pin.ref, exactVersion, planned, options.progress);
      continue;
    }

    // --ignore-plugin-versions: stamp exact constraints into upstream stubs
    // without contacting marketplaces (avoids hangs / missing installs).
    if (ignoreMissingInstall && !syncAll) {
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
      () =>
        syncPluginResource(syncTarget, {
          policy: "overwrite",
          onConflict: "overwrite",
          homeRoot,
          installRoot: movedOn && installedVersion
            ? cachedHostPluginRoot(homeRoot, pin.ref, installedVersion)
            : undefined,
        }),
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

    if (planOnly) {
      // Dry-run with a `*`, range or latest pin that is not installed: take
      // the version from the marketplace catalog, as the install would.
      const plannedVersion = await planInexactPinVersion(pin.ref, pin.version_constraint, homeRoot);
      if (plannedVersion) {
        planInstall(pin.ref, plannedVersion, planned, options.progress);
      }
      continue;
    }

    if (ignoreMissingInstall) {
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

  return {
    installs,
    syncedResourceCount,
    unresolvedPins,
    ...(planOnly ? { planned } : {}),
  };
}

function exactConstraintVersion(constraint: string): string | null {
  try {
    const parsed = parseVersionConstraint(constraint);
    return parsed.kind === "exact" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function planInexactPinVersion(
  ref: string,
  constraint: string,
  homeRoot: string,
): Promise<string | undefined> {
  if (parseDependencyRef(ref).source_kind !== "marketplace") return undefined;
  try {
    return await planMarketplacePinVersion({
      originRef: ref,
      versionConstraint: effectivePinConstraint(constraint),
      homeRoot,
      harnesstapDir: getHarnesstapDir(),
    });
  } catch {
    // An unreachable marketplace leaves the pin unresolved, as before.
    return undefined;
  }
}

/** Give the resolver a node for a pin a dry-run would install, without recording a version. */
function planInstall(
  ref: string,
  version: string,
  planned: PlannedPluginInstall[],
  progress: SyncPluginPinsForApplyProgress | undefined,
): void {
  const { name } = parseDependencyRef(ref);
  materializeUpstreamPlugin({ ref, name, version });
  const entry = { ref, name, version };
  planned.push(entry);
  progress?.onPlanned?.(entry);
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
    // HarnessTap resolves the dependencies itself, so it must know the
    // marketplaces the profile declares even when `claude` is not installed.
    registerDeclaredMarketplaces(options.claudeConfig, getHarnesstapDir());
  }
  // A dry-run leaves the harnesses' own marketplace lists alone.
  if (!options.skipSync && options.claudeConfig && !options.planOnly) {
    await ensureClaudeMarketplacesFromConfig(options.claudeConfig, {
      homeRoot: options.homeRoot ?? resolveHomeRoot(),
      projectRoot: options.projectRoot,
    });
  }

  if (!options.skipSync && options.pins.length > 0) {
    if (!options.planOnly) {
      const cursorEntries = selectCursorMarketplacesToEnsure(
        listMarketplaces(getHarnesstapDir()),
        options.pins.map((pin) => pin.ref),
      );
      await ensureCursorMarketplaces(cursorEntries, {
        homeRoot: options.homeRoot ?? resolveHomeRoot(),
        projectRoot: options.projectRoot,
      });
    }

    syncResult = await syncPluginPinsForApply({
      pins: options.pins,
      syncAll: options.syncAll,
      homeRoot: options.homeRoot,
      projectRoot: options.projectRoot,
      scope: options.scope,
      installPlatformId: options.installPlatformId,
      ignoreMissingInstall: options.ignoreMissingInstall,
      installInexactPins: options.installInexactPins,
      planOnly: options.planOnly,
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

/** The package cache copy of a marketplace plugin version, if the ref names one. */
function cachedHostPluginRoot(
  homeRoot: string,
  ref: string,
  version: string,
): string | undefined {
  const { name, marketplace } = parsePluginRef(ref);
  if (!marketplace) {
    return undefined;
  }
  return hostPluginPackageDir(harnesstapDirForHomeRoot(homeRoot), marketplace, name, version);
}
