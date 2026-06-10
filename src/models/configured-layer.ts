/** @deprecated Use layer-model */
import type { ConfiguredLayer, ConfiguredLayerPlugin } from "../types.js";
import {
  createLayerFromSources,
  getLayerById,
  getLayerByName,
  listLayers,
  resolveLayerSelector,
  setLayerDefaultEnvironment,
} from "./layer-model.js";

export function createConfiguredLayer(input: {
  name: string;
  version?: string;
  description?: string;
  pluginIds: string[];
  environmentId?: string;
}): ConfiguredLayer {
  return createLayerFromSources({
    name: input.name,
    version: input.version,
    description: input.description,
    sourceLayerIds: input.pluginIds,
    environmentId: input.environmentId,
  });
}

export function getConfiguredLayer(id: string): ConfiguredLayer | undefined {
  return getLayerById(id);
}

export function getConfiguredLayerByName(
  name: string,
  version?: string,
): ConfiguredLayer | undefined {
  return getLayerByName(name, version);
}

export function listConfiguredLayers(): ConfiguredLayer[] {
  return listLayers();
}

export function setConfiguredLayerDefaultEnvironment(
  configuredLayerId: string,
  environmentId: string | null,
): boolean {
  return setLayerDefaultEnvironment(configuredLayerId, environmentId);
}

export function unsetConfiguredLayerDefaultEnvironment(
  configuredLayerId: string,
): boolean {
  return setLayerDefaultEnvironment(configuredLayerId, null);
}

export function listConfiguredLayerPlugins(
  _configuredLayerId: string,
): ConfiguredLayerPlugin[] {
  return [];
}

export function findConfiguredLayerForPlugin(
  pluginId: string,
): ConfiguredLayer | undefined {
  return getLayerById(pluginId);
}

export function ensureImplicitConfiguredLayer(pluginId: string): ConfiguredLayer {
  const layer = getLayerById(pluginId);
  if (!layer) {
    throw new Error(`Layer not found: ${pluginId}`);
  }
  return layer;
}

export function resolveConfiguredLayerSelector(
  selector: string,
): ConfiguredLayer | undefined {
  return resolveLayerSelector(selector);
}
