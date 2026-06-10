export * from "./layer-model.js";
/** @deprecated Use layer-model */
export {
  createLayer,
  getLayer,
  listLayers,
  deleteLayer,
  parseLayerSelectorString as parseLayerSelector,
  addResourceToLayer,
  removeResourceFromLayer,
  getLayerResources,
  addDependencyToLayer,
  listLayerDependencies,
  removeDependencyFromLayer,
} from "./layer-model.js";
