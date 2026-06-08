import { resolve } from "node:path";
import { getConfiguredLayerByName, getConfiguredLayer, resolveConfiguredLayerSelector } from "../models/configured-layer.js";
import { getDeckByRootPath } from "../models/deck.js";
import { getEnvironment, resolveEnvironmentSelector } from "../models/environment.js";
import type { ConfiguredLayer, Deck, Environment } from "../types.js";

function isUlid(value: string): boolean {
  return /^[0-9A-Z]{26}$/.test(value);
}

export function resolveEnvironmentOrThrow(selector: string): Environment {
  const result = resolveEnvironmentSelector(selector);
  if (result.status === "found" && result.environment) {
    return result.environment;
  }
  if (result.status === "ambiguous") {
    const matches = (result.matches ?? []).map((environment) => environment.id).join(", ");
    throw new Error(`Environment selector is ambiguous: ${selector} (${matches})`);
  }
  throw new Error(`Environment not found: ${selector}`);
}

export function maybeResolveEnvironment(selector: string): Environment | undefined {
  const result = resolveEnvironmentSelector(selector);
  return result.status === "found" ? result.environment : undefined;
}

export function resolveConfiguredLayerOrThrow(selector: string): ConfiguredLayer {
  const layer = resolveConfiguredLayerSelector(selector);
  if (!layer) {
    throw new Error(`Configured layer not found: ${selector}`);
  }
  return layer;
}

export function resolveConfiguredLayerByNameOrId(
  selector: string,
): ConfiguredLayer | undefined {
  if (isUlid(selector)) {
    return getConfiguredLayer(selector);
  }
  return getConfiguredLayerByName(selector);
}

export function resolveDeckByProjectRoot(projectRoot: string): Deck | undefined {
  return getDeckByRootPath(resolve(projectRoot));
}

export function resolveEnvironmentByIdOrThrow(environmentId: string): Environment {
  const environment = getEnvironment(environmentId);
  if (!environment) {
    throw new Error(`Environment not found: ${environmentId}`);
  }
  return environment;
}
