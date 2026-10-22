import { getDb } from "../db/connection.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
  listPluginVersions,
  stampPluginOrigin,
} from "../models/plugin-model.js";
import { parsePluginRef } from "../plugins/host-plugin-manifest.js";
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
 * Plugin names are the graph key, so two marketplaces that ship a plugin with
 * the same name cannot both live in the library: the second sync would
 * overwrite the first one's resources. Returns the ref already holding the
 * name when `ref` comes from another marketplace and that pin still exists.
 */
export function findMarketplacePluginNameCollision(ref: string): string | undefined {
  const incoming = parsePluginRef(ref);
  if (!incoming.marketplace) return undefined;
  for (const version of listPluginVersions(incoming.name)) {
    const plugin = getPluginByName(incoming.name, version);
    const locator = plugin?.origin_locator;
    if (!plugin || !locator || getPluginOrigin(plugin.id) !== "upstream") continue;
    const held = parsePluginRef(locator);
    if (held.name === incoming.name && held.marketplace === incoming.marketplace) continue;
    if (!pluginPinExists(locator)) continue;
    return locator;
  }
  return undefined;
}

function pluginPinExists(ref: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 AS found FROM resources WHERE type = 'plugin' AND origin_ref = ? LIMIT 1")
    .get(ref) as { found: number } | undefined;
  return row !== undefined;
}

export class MarketplacePluginNameCollisionError extends Error {
  constructor(ref: string, heldBy: string) {
    const { name } = parsePluginRef(ref);
    super(
      `${ref} and ${heldBy} are both named "${name}". ` +
        `HarnessTap keeps one plugin per name, so ${ref} was not added and ${heldBy} is unchanged. ` +
        `Delete ${heldBy} from the library first to use ${ref}.`,
    );
    this.name = "MarketplacePluginNameCollisionError";
  }
}

export function assertNoMarketplacePluginNameCollision(ref: string): void {
  const heldBy = findMarketplacePluginNameCollision(ref);
  if (heldBy) {
    throw new MarketplacePluginNameCollisionError(ref, heldBy);
  }
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
  assertNoMarketplacePluginNameCollision(input.ref);
  const existing = getPluginByName(input.name, input.version);
  if (existing) {
    if (getPluginOrigin(existing.id) !== "upstream") {
      throw new Error(
        `${input.name}@${input.version} is an authored plugin; ` +
          `rename it or fork the upstream plugin under a different name.`,
      );
    }
    syncAttachments(existing.id, input.ref);
    stampPluginOrigin(existing.id, { locator: input.ref });
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
  stampPluginOrigin(plugin.id, { locator: input.ref });
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
