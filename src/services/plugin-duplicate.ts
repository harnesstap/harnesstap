import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginById,
  getPluginByName,
  getPluginResources,
  removeResourceFromPlugin,
  resolvePluginSelector,
  setPluginResourceOrder,
} from "../models/plugin-model.js";
import type { Plugin, PluginUpstream } from "../types.js";
import {
  ExtendsError,
  assertNoExtendsCycle,
  listComposedItems,
  listPluginExcludes,
  writePluginExcludes,
} from "./plugin-extends.js";
import { catalogUpstreamBase, forkPlugin, PluginForkError } from "./plugin-fork.js";
import { buildUpstream, formatUpstreamLabel, setPluginUpstream } from "./plugin-upstream.js";
import { markPluginClean, markPluginDirty } from "./plugin-versioning.js";

export type DuplicateMode = "inherit" | "copy";

export interface DuplicateResult {
  plugin: Plugin;
  source: Plugin;
  mode: DuplicateMode;
  upstream: PluginUpstream;
  /** Human label of the source, e.g. `org/catalog/slug@1.0.0`. */
  linked_to: string;
}

/**
 * Duplicate a plugin or profile.
 *
 * - `inherit` (Keep in sync) creates an empty child with an extends link; it
 *   shows the parent's items live and stores only its own changes.
 * - `copy` (Separate copy) is a fork: the items are attached to the new
 *   plugin and the link only records where it came from.
 */
export function duplicatePlugin(
  selector: string,
  opts: { name?: string; mode?: DuplicateMode } = {},
): DuplicateResult {
  const mode = opts.mode ?? "inherit";
  if (mode === "copy") {
    const fork = forkPlugin(selector, opts.name, { allowAuthored: true, defaultSuffix: "-copy" });
    return {
      plugin: fork.plugin,
      source: fork.source,
      mode,
      upstream: fork.upstream,
      linked_to: fork.forked_from,
    };
  }

  const source = resolvePluginSelector(selector);
  if (!source) {
    throw new PluginForkError("not_found", `Plugin not found: ${selector}`);
  }
  const name = opts.name?.trim() || `${source.name}-copy`;
  if (getPluginByName(name)) {
    throw new PluginForkError("plugin_exists", `Plugin ${name} already exists.`, source.name);
  }
  const upstream = buildUpstream("extends", catalogUpstreamBase(source) ?? source.name, source.version);
  assertNoExtendsCycle({ ...source, id: "", name, upstream: undefined } as Plugin, upstream, source.id);

  const db = getDb();
  const id = db.transaction(() => {
    const created = createPlugin({
      name,
      version: "1.0.0",
      description: source.description,
      tags: source.tags,
      ...(source.needs ? { needs: source.needs } : {}),
      origin: "authored",
    });
    setPluginUpstream(created.id, upstream, source.id);
    return created.id;
  })();

  const plugin = getPluginById(id);
  if (!plugin) {
    throw new PluginForkError("not_found", `Plugin not found after duplicate: ${name}`);
  }
  return { plugin, source, mode, upstream, linked_to: formatUpstreamLabel(upstream) };
}

export interface DetachResult {
  plugin: Plugin;
  /** Parent items now attached to the plugin itself. */
  materialized: number;
  /** The hidden list that no longer applies; kept here for the transcript. */
  hidden: string[];
  /** Pass to `undoDetachPlugin` to put the link back. */
  undo_token: string;
}

/** Everything detach changes, so Undo can put it back exactly. */
interface DetachUndoSnapshot {
  token: string;
  pluginId: string;
  upstream: PluginUpstream;
  upstreamPluginId: string;
  excludes: string[];
  ownOrder: string[];
  added: string[];
  wasDirty: boolean;
  workingSnapshot: { source_version: string; payload: string; created_at: string } | null;
  expiresAt: number;
}

/** Undo stays possible this long after a detach (the toast shows it for less). */
export const DETACH_UNDO_TTL_MS = 10 * 60 * 1000;

const detachUndoSnapshots = new Map<string, DetachUndoSnapshot>();

/** Test hook: forget pending Undo snapshots. */
export function clearDetachUndoSnapshots(): void {
  detachUndoSnapshots.clear();
}

/**
 * Turn a keep-in-sync child into a separate copy, in the Library only. The
 * effective set (parent items minus hidden ones, plus own items) becomes the
 * plugin's own attachments, the link becomes `fork` (it still says where it
 * came from), and nothing is applied to disk or deleted.
 */
export function detachPlugin(selector: string): DetachResult {
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new PluginForkError("not_found", `Plugin not found: ${selector}`);
  }
  if (plugin.upstream?.kind !== "extends") {
    throw new ExtendsError("not_extends", `${plugin.name} does not keep in sync with a parent; there is nothing to detach.`);
  }
  const upstream = plugin.upstream;
  // Resolve first: a missing parent throws here, before anything changes.
  const items = listComposedItems(plugin.id);
  const hidden = listPluginExcludes(plugin.id);
  const ownIds = new Set(getPluginResources(plugin.id).map((resource) => resource.id));

  const db = getDb();
  const ownOrder = getPluginResources(plugin.id).map((resource) => resource.id);
  const workingSnapshot =
    (db
      .prepare(
        "SELECT source_version, payload, created_at FROM plugin_working_snapshots WHERE plugin_id = ?",
      )
      .get(plugin.id) as DetachUndoSnapshot["workingSnapshot"] | undefined) ?? null;
  const added: string[] = [];
  let materialized = 0;
  db.transaction(() => {
    markPluginDirty(plugin.id);
    for (const item of items) {
      if (item.source !== "parent" || ownIds.has(item.resource.id)) continue;
      addResourceToPlugin(plugin.id, item.resource.id, item.resource.harness_scope);
      added.push(item.resource.id);
      materialized += 1;
    }
    setPluginResourceOrder(
      plugin.id,
      items.map((item) => item.resource.id),
    );
    setPluginUpstream(plugin.id, { ...upstream, kind: "fork" }, plugin.upstream_plugin_id ?? "");
    writePluginExcludes(plugin.id, []);
  })();

  const updated = getPluginById(plugin.id);
  if (!updated) {
    throw new PluginForkError("not_found", `Plugin not found after detach: ${plugin.name}`);
  }
  const token = randomUUID();
  detachUndoSnapshots.set(plugin.id, {
    token,
    pluginId: plugin.id,
    upstream,
    upstreamPluginId: plugin.upstream_plugin_id ?? "",
    excludes: hidden,
    ownOrder,
    added,
    wasDirty: plugin.dirty === true,
    workingSnapshot,
    expiresAt: Date.now() + DETACH_UNDO_TTL_MS,
  });
  return { plugin: updated, materialized, hidden, undo_token: token };
}

/**
 * Undo a detach: the link, the hidden list, the item order and the edited
 * state go back to what they were. Only the attachments detach added are
 * removed; no resource is deleted and nothing touches harness files.
 */
export function undoDetachPlugin(selector: string, token: string): Plugin {
  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    throw new PluginForkError("not_found", `Plugin not found: ${selector}`);
  }
  const snapshot = detachUndoSnapshots.get(plugin.id);
  if (
    !snapshot ||
    snapshot.token !== token ||
    snapshot.expiresAt < Date.now() ||
    plugin.upstream?.kind !== "fork" ||
    plugin.upstream.ref !== snapshot.upstream.ref
  ) {
    throw new ExtendsError("undo_expired", `Undo is no longer available for ${plugin.name}.`);
  }

  const db = getDb();
  db.transaction(() => {
    for (const resourceId of snapshot.added) {
      removeResourceFromPlugin(plugin.id, resourceId);
    }
    setPluginResourceOrder(plugin.id, snapshot.ownOrder);
    setPluginUpstream(plugin.id, snapshot.upstream, snapshot.upstreamPluginId);
    writePluginExcludes(plugin.id, snapshot.excludes);
    if (!snapshot.wasDirty) {
      markPluginClean(plugin.id);
      if (snapshot.workingSnapshot) {
        db.prepare(
          `INSERT INTO plugin_working_snapshots (plugin_id, source_version, payload, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(plugin_id) DO UPDATE SET
             source_version = excluded.source_version,
             payload = excluded.payload,
             created_at = excluded.created_at`,
        ).run(
          plugin.id,
          snapshot.workingSnapshot.source_version,
          snapshot.workingSnapshot.payload,
          snapshot.workingSnapshot.created_at,
        );
      } else {
        db.prepare("DELETE FROM plugin_working_snapshots WHERE plugin_id = ?").run(plugin.id);
      }
    }
  })();
  detachUndoSnapshots.delete(plugin.id);

  const updated = getPluginById(plugin.id);
  if (!updated) {
    throw new PluginForkError("not_found", `Plugin not found after undo: ${plugin.name}`);
  }
  return updated;
}
