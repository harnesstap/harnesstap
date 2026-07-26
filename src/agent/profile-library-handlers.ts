import { listLayers } from "../models/layer-model.js";
import { listResources } from "../models/resource.js";
import { jsonResponse } from "./http.js";

export function handleLibraryLayers(): Response {
  return jsonResponse({
    layers: listLayers().map((layer) => ({
      id: layer.id,
      name: layer.name,
      version: layer.version,
      tags: layer.tags,
      description: layer.description ?? null,
    })),
  });
}

export function handleLibraryResources(): Response {
  return jsonResponse({
    resources: listResources().map((resource) => ({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      namespace: resource.namespace ?? null,
      description: resource.description ?? null,
    })),
  });
}
