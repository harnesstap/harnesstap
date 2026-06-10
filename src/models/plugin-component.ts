/** @deprecated Use layer-model */
export {
  createLayer as createPlugin,
  getLayer as getPlugin,
  getLayerById as getPluginById,
  listLayers as listPlugins,
  deleteLayer as deletePlugin,
  parseLayerSelectorString as parsePluginSelector,
  addResourceToLayer as addResourceToPlugin,
  removeResourceFromLayer as removeResourceFromPlugin,
  getLayerResources as getPluginResources,
  addDependencyToLayer as addDependencyToPlugin,
  listLayerDependencies as listPluginDependencies,
  removeDependencyFromLayer as removeDependencyFromPlugin,
  syncClaudeLayerPluginsAfterAdd,
  syncClaudeLayerPluginsAfterRemove,
  type LayerSelector as PluginSelector,
} from "./layer-model.js";
