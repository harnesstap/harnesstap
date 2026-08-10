import type { PluginMarketplacePlatform } from "../config/settings.js";
import {
  getLayerById,
  ensureLayerClaudeMarketplace,
  resolveLayerSelector,
  syncClaudeLayerPluginsAfterAdd,
} from "../models/plugin-model.js";
import type { ClaudeMarketplaceSource } from "../types.js";
import {
  attachPluginPinToLayer,
  listAttachedPluginPins,
  parsePluginRef,
} from "./layer-composition.js";
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
  layerName: string;
  versionConstraint?: string;
  install?: typeof installPluginPinAsync;
  ensureMarketplaces?: typeof ensureClaudeMarketplacesFromConfig;
}

export interface AddPluginFromMarketplaceResult {
  status: "attached" | "already_attached";
  ref: string;
  layerName: string;
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

function requireLayer(layerName: string) {
  const layer = resolveLayerSelector(layerName);
  if (!layer) {
    throw new Error(`Layer not found: ${layerName}`);
  }
  return layer;
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
  const layer = requireLayer(input.layerName);
  const parsed = requireMarketplaceRef(input.ref);
  const marketplaceName = parsed.namespace;

  const marketplace = listMarketplaces(input.harnesstapDir).find(
    (entry) => entry.name === marketplaceName,
  );
  if (!marketplace) {
    throw new Error(`Marketplace not found in registry: ${marketplaceName}`);
  }

  const versionConstraint = input.versionConstraint ?? "latest";
  const existingPin = listAttachedPluginPins(layer.id).some(
    (pin) => pin.ref === input.ref,
  );
  let status: AddPluginFromMarketplaceResult["status"] = "attached";

  if (existingPin) {
    status = "already_attached";
  } else {
    attachPluginPinToLayer(layer.id, input.ref, versionConstraint);
    const attached = getLayerById(layer.id);
    if (!attached) {
      throw new Error(`Layer ${layer.id} not found after attaching plugin pin`);
    }
    syncClaudeLayerPluginsAfterAdd(attached, input.ref, versionConstraint);
  }

  let refreshed = getLayerById(layer.id);
  if (!refreshed) {
    throw new Error(`Layer ${layer.id} not found after plugin pin mutation`);
  }

  let marketplaceCopied = false;
  if (marketplace.platforms.includes("claude-code")) {
    marketplaceCopied = ensureLayerClaudeMarketplace(refreshed, marketplaceName, {
      source: claudeSourceFromMarketplaceUrl(marketplace.url),
    });
    if (marketplaceCopied) {
      refreshed = getLayerById(layer.id);
      if (!refreshed) {
        throw new Error(`Layer ${layer.id} not found after marketplace copy`);
      }
    }
  }

  let installResult: InstallPluginPinResult | undefined;
  const activeProfile = getActiveProfileName();
  if (activeProfile === layer.name) {
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
    layerName: layer.name,
    marketplaceCopied,
    ...(installResult ? { install: installResult } : {}),
  };
}
