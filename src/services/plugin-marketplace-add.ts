import type { PluginMarketplacePlatform } from "../config/settings.js";
import {
  getPluginById,
  ensurePluginClaudeMarketplace,
  resolvePluginSelector,
  syncClaudeMarketplacePluginsAfterAdd,
} from "../models/plugin-model.js";
import type { ClaudeMarketplaceSource } from "../types.js";
import {
  attachPluginPinToPlugin,
  listAttachedPluginPins,
  parsePluginRef,
} from "./plugin-composition.js";
import { listMarketplaces } from "./marketplace-registry.js";
import { getActiveProfileName } from "./active-profile.js";
import {
  ensureClaudeMarketplacesFromConfig,
  type EnsureMarketplacesOptions,
} from "./claude-marketplace-bootstrap.js";
import {
  installPluginPinAsync,
  resolveDefaultPluginInstallScope,
  type InstallPluginPinResult,
} from "./plugin-install.js";

export interface AddPluginFromMarketplaceInput {
  harnesstapDir: string;
  homeRoot: string;
  projectRoot: string;
  ref: string;
  pluginName: string;
  versionConstraint?: string;
  install?: typeof installPluginPinAsync;
  ensureMarketplaces?: typeof ensureClaudeMarketplacesFromConfig;
}

export interface AddPluginFromMarketplaceResult {
  status: "attached" | "already_attached";
  ref: string;
  pluginName: string;
  marketplaceCopied: boolean;
  install?: InstallPluginPinResult;
}

const GITHUB_REPO_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/i;

export function claudeSourceFromMarketplaceUrl(url: string): ClaudeMarketplaceSource {
  const trimmed = url.trim();
  const githubMatch = trimmed.match(GITHUB_REPO_PATTERN);
  if (githubMatch) {
    return { source: "github", repo: githubMatch[1] };
  }
  return { source: "url", url: trimmed };
}

function preferredInstallPlatform(platforms: PluginMarketplacePlatform[]): string {
  if (platforms.includes("claude-code")) {
    return "claude-code";
  }
  const first = platforms[0];
  if (!first) {
    throw new Error("Marketplace has no platforms configured");
  }
  return first;
}

function requirePlugin(pluginName: string) {
  const plugin = resolvePluginSelector(pluginName);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginName}`);
  }
  return plugin;
}

function requireMarketplaceRef(ref: string) {
  const parsed = parsePluginRef(ref);
  if (!parsed.namespace) {
    throw new Error(`Plugin ref must include a marketplace namespace: ${ref}`);
  }
  return parsed;
}

export async function addPluginFromMarketplace(
  input: AddPluginFromMarketplaceInput,
): Promise<AddPluginFromMarketplaceResult> {
  const plugin = requirePlugin(input.pluginName);
  const parsed = requireMarketplaceRef(input.ref);
  const marketplaceName = parsed.namespace;

  const marketplace = listMarketplaces(input.harnesstapDir).find(
    (entry) => entry.name === marketplaceName,
  );
  if (!marketplace) {
    throw new Error(`Marketplace not found in registry: ${marketplaceName}`);
  }

  const versionConstraint = input.versionConstraint ?? "latest";
  const existingPin = listAttachedPluginPins(plugin.id).some(
    (pin) => pin.ref === input.ref,
  );
  let status: AddPluginFromMarketplaceResult["status"] = "attached";

  if (existingPin) {
    status = "already_attached";
  } else {
    attachPluginPinToPlugin(plugin.id, input.ref, versionConstraint);
    const attached = getPluginById(plugin.id);
    if (!attached) {
      throw new Error(`Plugin ${plugin.id} not found after attaching plugin pin`);
    }
    syncClaudeMarketplacePluginsAfterAdd(attached, input.ref, versionConstraint);
  }

  let refreshed = getPluginById(plugin.id);
  if (!refreshed) {
    throw new Error(`Plugin ${plugin.id} not found after plugin pin mutation`);
  }

  let marketplaceCopied = false;
  if (marketplace.platforms.includes("claude-code")) {
    marketplaceCopied = ensurePluginClaudeMarketplace(refreshed, marketplaceName, {
      source: claudeSourceFromMarketplaceUrl(marketplace.url),
    });
    if (marketplaceCopied) {
      refreshed = getPluginById(plugin.id);
      if (!refreshed) {
        throw new Error(`Plugin ${plugin.id} not found after marketplace copy`);
      }
    }
  }

  let installResult: InstallPluginPinResult | undefined;
  const activeProfile = getActiveProfileName();
  if (activeProfile === plugin.name) {
    const ensureMarketplaces = input.ensureMarketplaces ?? ensureClaudeMarketplacesFromConfig;
    const ensureOptions: EnsureMarketplacesOptions = {
      homeRoot: input.homeRoot,
      projectRoot: input.projectRoot,
    };
    ensureMarketplaces(refreshed.claude, ensureOptions);

    const install = input.install ?? installPluginPinAsync;
    installResult = await install({
      ref: input.ref,
      scope: resolveDefaultPluginInstallScope(input.projectRoot),
      installPlatformId: preferredInstallPlatform(marketplace.platforms),
      homeRoot: input.homeRoot,
      projectRoot: input.projectRoot,
    });
  }

  return {
    status,
    ref: input.ref,
    pluginName: plugin.name,
    marketplaceCopied,
    ...(installResult ? { install: installResult } : {}),
  };
}
