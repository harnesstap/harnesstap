export * from "./plugin-component.js";
/** @deprecated Use plugin-component */
export {
  createPlugin as createLayer,
  getPlugin as getLayer,
  listPlugins as listLayers,
  deletePlugin as deleteLayer,
  parsePluginSelector as parseLayerSelector,
  addResourceToPlugin as addResourceToLayer,
  removeResourceFromPlugin as removeResourceFromLayer,
  getPluginResources as getLayerResources,
  addDependencyToPlugin as addDependencyToLayer,
  listPluginDependencies as listLayerDependencies,
  removeDependencyFromPlugin as removeDependencyFromLayer,
} from "./plugin-component.js";
