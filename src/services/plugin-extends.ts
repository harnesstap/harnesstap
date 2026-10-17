import semver from "semver";
import { getDb } from "../db/connection.js";
import { getPluginById, getPluginResources } from "../models/plugin-model.js";
import { RESOURCE_TYPES, type Plugin, type PluginUpstream, type Resource } from "../types.js";
import { isHostPluginPinResource } from "./host-plugin-serialize.js";
import { dependenciesFromResources, type DependencyView } from "./plugin-dependency.js";
import { isCatalogUpstreamRef, upstreamRefBase } from "./plugin-upstream.js";
import { markPluginDirty } from "./plugin-versioning.js";
import { computationSlot } from "./status-computation.js";

/**
 * A profile that extends a parent (`upstream.kind = "extends"`) shows the
 * parent's items live, minus the entries it hides, plus its own items. The
 * composition happens at read time, so a parent edit reaches every child and
 * nothing is copied. Hidden entries use the package's exclude strings:
 * `<type>:<name>` for a resource, `plugin:<name>` for a dependency.
 */

export type ExtendsErrorCode = "parent_missing" | "cycle" | "invalid_exclude" | "not_extends";

export class ExtendsError extends Error {
  readonly code: ExtendsErrorCode;
  readonly ref?: string;
  readonly hint?: string;

  constructor(code: ExtendsErrorCode, message: string, opts?: { ref?: string; hint?: string }) {
    super(message);
    this.name = "ExtendsError";
    this.code = code;
    if (opts?.ref) this.ref = opts.ref;
    if (opts?.hint) this.hint = opts.hint;
  }
}

export interface ComposedItem {
  resource: Resource;
  source: "parent" | "own";
}

interface CandidateRow {
  id: string;
  name: string;
  version: string;
  frozen_at: string | null;
}

/** Validates one exclude string and returns it normalized. */
export function parseExcludeEntry(entry: string): { type: string; name: string } {
  const trimmed = entry.trim();
  const colon = trimmed.indexOf(":");
  const type = colon > 0 ? trimmed.slice(0, colon) : "";
  const name = colon > 0 ? trimmed.slice(colon + 1).trim() : "";
  if (!type || !name || !(RESOURCE_TYPES as readonly string[]).includes(type)) {
    throw new ExtendsError(
      "invalid_exclude",
      `Invalid hidden item "${entry}". Use <type>:<name>, where type is one of ${RESOURCE_TYPES.join(", ")}.`,
    );
  }
  return { type, name };
}

export function normalizeExcludeEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const { type, name } = parseExcludeEntry(entry);
    seen.add(`${type}:${name}`);
  }
  return [...seen].sort();
}

/** The exclude key an item answers to: `skill:review`, `plugin:feature-dev`. */
export function excludeKeyOf(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

export function listPluginExcludes(pluginId: string): string[] {
  const rows = getDb()
    .prepare("SELECT entry FROM plugin_excludes WHERE plugin_id = ? ORDER BY entry")
    .all(pluginId) as Array<{ entry: string }>;
  return rows.map((row) => row.entry);
}

/** Replaces the hidden list. Callers mark the plugin dirty first. */
export function writePluginExcludes(pluginId: string, entries: readonly string[]): string[] {
  const normalized = normalizeExcludeEntries(entries);
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM plugin_excludes WHERE plugin_id = ?").run(pluginId);
    const insert = db.prepare(
      "INSERT INTO plugin_excludes (plugin_id, entry, created_at) VALUES (?, ?, ?)",
    );
    for (const entry of normalized) {
      insert.run(pluginId, entry, now);
    }
  })();
  return normalized;
}

/**
 * Sets the items an extends child hides. Only an extends link can hide
 * anything; a fork owns its copy and edits it directly.
 */
export function setPluginExcludes(pluginId: string, entries: readonly string[]): string[] {
  const plugin = getPluginById(pluginId);
  if (!plugin) {
    throw new ExtendsError("not_extends", `Plugin not found: ${pluginId}`);
  }
  if (plugin.upstream?.kind !== "extends") {
    throw new ExtendsError(
      "not_extends",
      `${plugin.name} does not keep in sync with a parent, so it has nothing to hide.`,
    );
  }
  const normalized = normalizeExcludeEntries(entries);
  const current = listPluginExcludes(pluginId);
  if (current.join("\n") === normalized.join("\n")) {
    return current;
  }
  markPluginDirty(pluginId);
  return writePluginExcludes(pluginId, normalized);
}

function upstreamKindOf(pluginId: string): string {
  const row = getDb()
    .prepare("SELECT upstream_kind FROM plugins WHERE id = ?")
    .get(pluginId) as { upstream_kind?: string } | undefined;
  return row?.upstream_kind ?? "";
}

function upstreamRange(ref: string): string {
  const at = ref.lastIndexOf("@");
  const range = at > 0 ? ref.slice(at + 1) : "*";
  return semver.validRange(range) ? range : "*";
}

function candidateRows(upstream: PluginUpstream, linkedId: string | undefined): CandidateRow[] {
  const db = getDb();
  const base = upstreamRefBase(upstream.ref);
  const rows: CandidateRow[] = [];
  if (isCatalogUpstreamRef(upstream.ref)) {
    const [org, catalog, slug] = base.split("/");
    rows.push(
      ...(db
        .prepare(
          `SELECT id, name, version, frozen_at FROM plugins
           WHERE org_slug = ? AND catalog_slug = ?
             AND (ap_name = ? OR name = ? OR origin_locator = ? OR origin_locator LIKE ?)`,
        )
        .all(org, catalog, slug, slug, base, `${base}@%`) as CandidateRow[]),
    );
  } else {
    rows.push(
      ...(db
        .prepare("SELECT id, name, version, frozen_at FROM plugins WHERE name = ?")
        .all(base) as CandidateRow[]),
    );
  }
  if (linkedId) {
    const linked = getPluginById(linkedId);
    if (linked) {
      rows.push(
        ...(db
          .prepare(
            `SELECT id, name, version, frozen_at FROM plugins
             WHERE name = ? AND org_slug = ? AND catalog_slug = ?`,
          )
          .all(linked.name, linked.org_slug, linked.catalog_slug) as CandidateRow[]),
      );
    }
  }
  const unique = new Map(rows.map((row) => [row.id, row]));
  return [...unique.values()];
}

/**
 * The installed parent version that satisfies the child's upstream range:
 * the newest match, so an in-range parent update reaches the child.
 */
export function resolveUpstreamParent(
  plugin: Plugin,
  opts?: { includeSelf?: boolean },
): Plugin | undefined {
  if (!plugin.upstream) return undefined;
  const range = upstreamRange(plugin.upstream.ref);
  const matches = candidateRows(plugin.upstream, plugin.upstream_plugin_id)
    .filter((row) => opts?.includeSelf || (row.id !== plugin.id && row.name !== plugin.name))
    .filter((row) => semver.valid(row.version) && semver.satisfies(row.version, range))
    .sort((a, b) => semver.rcompare(a.version, b.version) || Number(a.frozen_at !== null) - Number(b.frozen_at !== null));
  const best = matches[0];
  return best ? getPluginById(best.id) : undefined;
}

export function parentMissingError(plugin: Plugin): ExtendsError {
  const upstream = plugin.upstream as PluginUpstream;
  const base = upstreamRefBase(upstream.ref);
  const hint = isCatalogUpstreamRef(upstream.ref)
    ? `ht profile pull ${base}@${upstream.version_at_link || "latest"}`
    : undefined;
  return new ExtendsError(
    "parent_missing",
    `Parent ${upstream.ref} of ${plugin.name} is not installed.` +
      (hint ? ` Run \`${hint}\` first.` : ""),
    { ref: upstream.ref, ...(hint ? { hint } : {}) },
  );
}

function isOwnHostPin(plugin: Pick<Plugin, "name">, resource: Resource): boolean {
  return resource.name === plugin.name && isHostPluginPinResource(resource);
}

function composeItems(pluginId: string, chain: string[]): ComposedItem[] {
  const own = getPluginResources(pluginId);
  if (upstreamKindOf(pluginId) !== "extends") {
    return own.map((resource) => ({ resource, source: "own" as const }));
  }
  const plugin = getPluginById(pluginId);
  if (!plugin?.upstream) {
    return own.map((resource) => ({ resource, source: "own" as const }));
  }
  const parent = resolveUpstreamParent(plugin);
  if (!parent) {
    throw parentMissingError(plugin);
  }
  if (chain.includes(parent.name)) {
    throw new ExtendsError(
      "cycle",
      `${plugin.name} cannot extend ${parent.name}: ${[...chain, parent.name].join(" > ")} is a cycle.`,
    );
  }
  const hidden = new Set(listPluginExcludes(plugin.id));
  const ownKeys = new Set(own.map(excludeKeyOf));
  const inherited = composeItems(parent.id, [...chain, parent.name])
    .map((item) => item.resource)
    .filter((resource) => !isOwnHostPin(parent, resource))
    .filter((resource) => !hidden.has(excludeKeyOf(resource)) && !ownKeys.has(excludeKeyOf(resource)))
    .map((resource) => ({ resource, source: "parent" as const }));
  return [...inherited, ...own.map((resource) => ({ resource, source: "own" as const }))];
}

/** Own and inherited items, each tagged with where it comes from. */
export function listComposedItems(pluginId: string): ComposedItem[] {
  const plugin = getPluginById(pluginId);
  return composeItems(pluginId, plugin ? [plugin.name] : []);
}

/**
 * The resources a plugin contributes when resolved or applied. For a plugin
 * that does not extend anything this is exactly getPluginResources.
 */
export function getComposedPluginResources(pluginId: string): Resource[] {
  return computationSlot(`plugin-composed:${pluginId}`, () => {
    if (upstreamKindOf(pluginId) !== "extends") {
      return getPluginResources(pluginId);
    }
    return listComposedItems(pluginId).map((item) => item.resource);
  }).slice();
}

/** listDependencies over the composed set. */
export function listComposedDependencies(pluginId: string): DependencyView[] {
  const plugin = getPluginById(pluginId);
  return dependenciesFromResources(getComposedPluginResources(pluginId)).filter(
    (dependency) => !(plugin && dependency.name === plugin.name && isHostPluginPinResource(dependency.resource)),
  );
}

/**
 * Refuses a link that would make a plugin extend itself, directly or through
 * its parents. Checked when a link is created and when a package is imported.
 */
export function assertNoExtendsCycle(plugin: Plugin, upstream: PluginUpstream, upstreamPluginId?: string): void {
  if (upstream.kind !== "extends") return;
  const seen = [plugin.name];
  let current: Plugin | undefined = resolveUpstreamParent(
    {
      ...plugin,
      upstream,
      ...(upstreamPluginId ? { upstream_plugin_id: upstreamPluginId } : {}),
    },
    { includeSelf: true },
  );
  while (current) {
    if (seen.includes(current.name)) {
      throw new ExtendsError(
        "cycle",
        `${plugin.name} cannot extend ${upstream.ref}: ${[...seen, current.name].join(" > ")} is a cycle.`,
      );
    }
    seen.push(current.name);
    if (current.upstream?.kind !== "extends") return;
    current = resolveUpstreamParent(current);
  }
}
