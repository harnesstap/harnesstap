import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../models/plugin-model.js";
import { listResourcesByOriginRef } from "../models/resource.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";
import { getPluginOrigin, setPluginOrigin } from "./plugin-origin.js";
import type { Plugin, MaterialResourceType } from "../types.js";

function isMaterial(type: string): type is MaterialResourceType {
  return (MATERIAL_RESOURCE_TYPES as readonly string[]).includes(type);
}

export interface MaterializeUpstreamInput {
  /** The dependency ref that produced the install, e.g. `web-search@anthropics`. */
  ref: string;
  /** Plugin name; becomes the plugin name and therefore the graph node key. */
  name: string;
  /** Resolved version from the install tree. */
  version: string;
}

/**
 * Turn an installed plugin tree into a real plugin row so the resolver can
 * treat it as an ordinary graph node.
 *
 * The install's material resources are already stored with
 * `origin_kind = 'marketplace_link'` and `origin_ref` set to the dependency
 * ref; this attaches exactly those to a plugin tagged `upstream`.
 */
export function materializeUpstreamPlugin(
  input: MaterializeUpstreamInput,
): Plugin {
  const existing = getPluginByName(input.name, input.version);
  if (existing) {
    if (getPluginOrigin(existing.id) !== "upstream") {
      throw new Error(
        `${input.name}@${input.version} is an authored plugin; ` +
          `rename it or fork the upstream plugin under a different name.`,
      );
    }
    syncAttachments(existing.id, input.ref);
    return existing;
  }

  const plugin = createPlugin({
    name: input.name,
    version: input.version,
    description: `Upstream plugin ${input.ref}`,
    origin: "upstream",
  });
  setPluginOrigin(plugin.id, "upstream");
  syncAttachments(plugin.id, input.ref);
  return plugin;
}

function syncAttachments(pluginId: string, ref: string): void {
  const attached = new Set(getPluginResources(pluginId).map((resource) => resource.id));
  for (const resource of listResourcesByOriginRef(ref, "marketplace_link")) {
    if (!isMaterial(resource.type)) continue;
    if (attached.has(resource.id)) continue;
    addResourceToPlugin(pluginId, resource.id);
  }
}
