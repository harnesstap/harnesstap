import { getHarnesstapDir } from "../db/connection.js";
import { parsePluginRef } from "../plugins/claude-installed.js";
import { getPluginProvider } from "../plugins/registry.js";
import type { PluginScope } from "../plugins/types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";
import { clearLiveReadCaches } from "./live-read-cache.js";
import { installMarketplacePinIntoCache } from "./marketplace-pin-cache.js";
import { importPluginFromGitHubRef } from "./plugin-git-import.js";
import { parseGitDependencyConstraint } from "../utils/git-dependency-constraint.js";
import { parseDependencyRef } from "../utils/plugin-dependency-ref.js";

export interface InstallPluginPinOptions {
  ref: string;
  scope: PluginScope;
  installPlatformId?: string;
  homeRoot: string;
  projectRoot: string;
  versionConstraint?: string;
}

export interface InstallPluginPinResult {
  ref: string;
  platformId: string;
  scope: PluginScope;
  status: "installed" | "already_installed" | "failed" | "unsupported";
  message: string;
  /** The version a marketplace install put in the package cache. */
  version?: string;
}

/** True when a git dependency constraint names a commit, tag, branch or semver range. */
export function isPinnedGitConstraint(constraint: string | undefined): boolean {
  try {
    return parseGitDependencyConstraint(constraint).kind !== "none";
  } catch {
    return true;
  }
}

export async function installPluginPinAsync(
  options: InstallPluginPinOptions,
): Promise<InstallPluginPinResult> {
  const platformId = options.installPlatformId ?? "claude-code";
  if (parseDependencyRef(options.ref).source_kind === "git") {
    // Fetch the pinned commit, tag or branch into the HarnessTap git cache
    // (#500). Fall through to the host provider when that is not possible.
    try {
      const imported = await importPluginFromGitHubRef(options.ref, undefined, {
        ref: options.versionConstraint,
        anyGitRemote: true,
      });
      clearLiveReadCaches();
      return {
        ref: options.ref,
        platformId,
        scope: options.scope,
        status: imported.created ? "installed" : "already_installed",
        message: `Fetched ${imported.origin_locator} at ${imported.origin_fingerprint.slice(0, 12)}`,
      };
    } catch (error) {
      // A pinned git dependency fails closed with the git error. An unpinned
      // one still falls back to the host provider, as before.
      if (isPinnedGitConstraint(options.versionConstraint)) {
        return {
          ref: options.ref,
          platformId,
          scope: options.scope,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  const { marketplace } = parsePluginRef(options.ref);
  if (marketplace) {
    try {
      const cached = await installMarketplacePinIntoCache({
        originRef: options.ref,
        versionConstraint: options.versionConstraint,
        homeRoot: options.homeRoot,
        harnesstapDir: getHarnesstapDir(),
      });
      clearLiveReadCaches();
      return {
        ref: options.ref,
        platformId,
        scope: options.scope,
        status: "installed",
        message: `Cached ${options.ref}@${cached.version}`,
        version: cached.version,
      };
    } catch {
      // Fall through to the host provider when the package cache cannot
      // resolve the pin from a marketplace checkout.
    }
  }
  const provider = getPluginProvider(platformId);
  if (!provider) {
    return {
      ref: options.ref,
      platformId,
      scope: options.scope,
      status: "unsupported",
      message: `No plugin provider registered for ${platformId}`,
    };
  }

  try {
    const result = await provider.install(
      {
        projectRoot: options.projectRoot,
        homeRoot: options.homeRoot,
        harnesstapDir: getHarnesstapDir(),
      },
      {
        ref: options.ref,
        scope: options.scope,
      },
    );

    return {
      ref: result.ref,
      platformId: result.platformId,
      scope: result.scope,
      status: result.status,
      message: result.message,
    };
  } finally {
    clearLiveReadCaches();
  }
}

export function resolveDefaultPluginInstallScope(projectRoot: string): PluginScope {
  return projectRoot ? "project" : "user";
}

export function resolvePluginInstallScope(
  projectRoot: string,
  hasGitOrigin: boolean,
): PluginScope {
  return hasGitOrigin ? "project" : resolveDefaultPluginInstallScope(projectRoot);
}

export interface InstallPluginPinsProgress {
  onInstallStart?: (ref: string) => void;
  onInstallComplete?: (result: InstallPluginPinResult) => void;
}

export async function installPluginPins(
  pins: PluginConstraintPin[],
  options: {
    homeRoot?: string;
    projectRoot: string;
    scope: PluginScope;
    installPlatformId?: string;
    progress?: InstallPluginPinsProgress;
  },
): Promise<InstallPluginPinResult[]> {
  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const results: InstallPluginPinResult[] = [];

  for (const pin of pins) {
    if (!pin.version_constraint) {
      continue;
    }
    options.progress?.onInstallStart?.(pin.ref);
    const result = await installPluginPinAsync({
      ref: pin.ref,
      scope: options.scope,
      installPlatformId: options.installPlatformId,
      homeRoot,
      projectRoot: options.projectRoot,
      versionConstraint: pin.version_constraint,
    });
    options.progress?.onInstallComplete?.(result);
    results.push(result);
  }

  return results;
}
