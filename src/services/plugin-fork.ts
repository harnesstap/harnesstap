import { getDb } from "../db/connection.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginById,
  getPluginByName,
  getPluginResources,
  resolveApName,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { getPluginOrigin } from "./plugin-origin.js";
import { formatCanonicalPublishedSelector } from "./plugin-selector.js";

export type PluginForkErrorCode = "not_found" | "already_authored" | "plugin_exists";

export class PluginForkError extends Error {
  readonly code: PluginForkErrorCode;
  readonly sourceName?: string;

  constructor(code: PluginForkErrorCode, message: string, sourceName?: string) {
    super(message);
    this.name = "PluginForkError";
    this.code = code;
    this.sourceName = sourceName;
  }
}

/**
 * The reference a fork keeps to the plugin it was copied from. A catalog
 * source is recorded by its catalog selector so the link still means
 * something on another machine; anything else by local name and version.
 */
export function forkSourceRef(source: Plugin): string {
  if (source.org_slug && source.catalog_slug) {
    // A pull records the catalog selector in origin_locator. Prefer it: older
    // pulls named the local plugin after its display name, not its slug.
    const prefix = `${source.org_slug}/${source.catalog_slug}/`;
    const selector = source.origin_locator?.startsWith(prefix)
      ? source.origin_locator
      : formatCanonicalPublishedSelector({
          org: source.org_slug,
          catalog: source.catalog_slug,
          name: resolveApName(source),
        });
    return `${selector}@${source.version}`;
  }
  return `${source.name}@${source.version}`;
}

export interface ForkResult {
  plugin: Plugin;
  source: Plugin;
  forked_from: string;
}

export function forkPlugin(selector: string, asName?: string): ForkResult {
  const source = resolvePluginSelector(selector);
  if (!source) {
    throw new PluginForkError("not_found", `Plugin not found: ${selector}`);
  }
  if (getPluginOrigin(source.id) === "authored") {
    throw new PluginForkError(
      "already_authored",
      `${source.name} is already authored; there is nothing to fork.`,
      source.name,
    );
  }
  const name = asName?.trim() || `${source.name}-fork`;
  if (getPluginByName(name)) {
    throw new PluginForkError("plugin_exists", `Plugin ${name} already exists.`, source.name);
  }

  const forkedFrom = forkSourceRef(source);
  const db = getDb();
  const fork = db.transaction(() => {
    const created = createPlugin({
      name,
      version: source.version,
      description: source.description || `Fork of ${source.name}@${source.version}`,
      tags: source.tags,
      ...(source.claude ? { claude: source.claude } : {}),
      ...(source.needs ? { needs: source.needs } : {}),
      origin: "authored",
    });
    setPluginForkSource(created.id, { forked_from: forkedFrom, forked_from_id: source.id });
    // Resource rows are shared, not copied: a fork diverges by attaching and
    // detaching, and editing a resource is a separate, explicit operation.
    for (const resource of getPluginResources(source.id)) {
      addResourceToPlugin(created.id, resource.id);
    }
    return created.id;
  })();

  const plugin = getPluginById(fork);
  if (!plugin) {
    throw new PluginForkError("not_found", `Plugin not found after fork: ${name}`);
  }
  return { plugin, source, forked_from: forkedFrom };
}

export function setPluginForkSource(
  pluginId: string,
  link: { forked_from: string; forked_from_id: string },
): void {
  getDb()
    .prepare("UPDATE plugins SET forked_from = ?, forked_from_id = ? WHERE id = ?")
    .run(link.forked_from, link.forked_from_id, pluginId);
}
