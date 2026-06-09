import { getHarnessdeckDir } from "../db/connection.js";
import { getPluginProvider } from "../plugins/registry.js";
import type { PluginScope } from "../plugins/types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";

export interface InstallPluginPinOptions {
  ref: string;
  scope: PluginScope;
  installPlatformId?: string;
  homeRoot: string;
  projectRoot: string;
}

export interface InstallPluginPinResult {
  ref: string;
  platformId: string;
  scope: PluginScope;
  status: "installed" | "already_installed" | "failed" | "unsupported";
  message: string;
}

export async function installPluginPinAsync(
  options: InstallPluginPinOptions,
): Promise<InstallPluginPinResult> {
  const platformId = options.installPlatformId ?? "claude-code";
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

  const result = await provider.install(
    {
      projectRoot: options.projectRoot,
      homeRoot: options.homeRoot,
      harnessdeckDir: getHarnessdeckDir(),
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
    });
    options.progress?.onInstallComplete?.(result);
    results.push(result);
  }

  return results;
}
