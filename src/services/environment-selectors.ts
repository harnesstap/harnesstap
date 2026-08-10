import { getPluginByName, getPluginById, resolvePluginSelector } from "../models/plugin-model.js";
import { getEnvironment, resolveEnvironmentSelector } from "../models/environment.js";
import type { Plugin, Environment } from "../types.js";

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

export function resolveConfiguredPluginOrThrow(selector: string): Plugin {
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new Error(`Configured plugin not found: ${selector}`);
  }
  return plugin;
}

export function resolveConfiguredPluginByNameOrId(
  selector: string,
): Plugin | undefined {
  if (isUlid(selector)) {
    return getPluginById(selector);
  }
  return getPluginByName(selector);
}

export function resolveEnvironmentByIdOrThrow(environmentId: string): Environment {
  const environment = getEnvironment(environmentId);
  if (!environment) {
    throw new Error(`Environment not found: ${environmentId}`);
  }
  return environment;
}
