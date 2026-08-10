import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
  getLayerResources,
} from "../models/plugin-model.js";
import { listResourcesByOriginRef } from "../models/resource.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";
import { getLayerOrigin, setLayerOrigin } from "./layer-origin.js";
import type { Layer, MaterialResourceType } from "../types.js";

function isMaterial(type: string): type is MaterialResourceType {
  return (MATERIAL_RESOURCE_TYPES as readonly string[]).includes(type);
}

export interface MaterializeUpstreamInput {
  /** The dependency ref that produced the install, e.g. `web-search@anthropics`. */
  ref: string;
  /** Plugin name; becomes the layer name and therefore the graph node key. */
  name: string;
  /** Resolved version from the install tree. */
  version: string;
}

/**
 * Turn an installed plugin tree into a real layer row so the resolver can
 * treat it as an ordinary graph node.
 *
 * The install's material resources are already stored with
 * `origin_kind = 'marketplace_link'` and `origin_ref` set to the dependency
 * ref; this attaches exactly those to a layer tagged `upstream`.
 */
export function materializeUpstreamPluginLayer(
  input: MaterializeUpstreamInput,
): Layer {
  const existing = getLayerByName(input.name, input.version);
  if (existing) {
    if (getLayerOrigin(existing.id) !== "upstream") {
      throw new Error(
        `${input.name}@${input.version} is an authored plugin; ` +
          `rename it or fork the upstream plugin under a different name.`,
      );
    }
    syncAttachments(existing.id, input.ref);
    return existing;
  }

  const layer = createLayer({
    name: input.name,
    version: input.version,
    description: `Upstream plugin ${input.ref}`,
    origin: "upstream",
  });
  setLayerOrigin(layer.id, "upstream");
  syncAttachments(layer.id, input.ref);
  return layer;
}

function syncAttachments(layerId: string, ref: string): void {
  const attached = new Set(getLayerResources(layerId).map((resource) => resource.id));
  for (const resource of listResourcesByOriginRef(ref, "marketplace_link")) {
    if (!isMaterial(resource.type)) continue;
    if (attached.has(resource.id)) continue;
    addResourceToLayer(layerId, resource.id);
  }
}
