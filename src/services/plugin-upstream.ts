import semver from "semver";
import { getDb } from "../db/connection.js";
import type { PluginUpstream, PluginUpstreamKind } from "../types.js";

/**
 * The upstream link uses the package format's shape, from
 * `extensions["com.harnesstap"].upstream`:
 * `{ kind: "extends" | "fork", ref: "org/catalog/slug@range", version_at_link: "x.y.z" }`.
 * Only catalog refs are portable, so only they are exported.
 */
const UPSTREAM_KINDS: readonly PluginUpstreamKind[] = ["extends", "fork"];
const CATALOG_REF = /^[^/@\s]+\/[^/@\s]+\/[^/@\s]+@\S+$/;

interface UpstreamRow {
  upstream_kind?: string;
  upstream_ref?: string;
  upstream_version_at_link?: string;
  upstream_plugin_id?: string;
}

export function upstreamFromRow(
  row: UpstreamRow,
): { upstream?: PluginUpstream; upstream_plugin_id?: string } {
  const kind = row.upstream_kind as PluginUpstreamKind | undefined;
  if (!kind || !UPSTREAM_KINDS.includes(kind) || !row.upstream_ref) {
    return {};
  }
  return {
    upstream: {
      kind,
      ref: row.upstream_ref,
      version_at_link: row.upstream_version_at_link ?? "",
    },
    ...(row.upstream_plugin_id ? { upstream_plugin_id: row.upstream_plugin_id } : {}),
  };
}

export function isCatalogUpstreamRef(ref: string): boolean {
  return CATALOG_REF.test(ref);
}

/** `^x.y.z` for a semver version (no automatic major), else `*`. */
export function upstreamRange(version: string): string {
  return semver.valid(version) ? `^${version}` : "*";
}

export function buildUpstream(
  kind: PluginUpstreamKind,
  base: string,
  version: string,
): PluginUpstream {
  return {
    kind,
    ref: `${base}@${upstreamRange(version)}`,
    version_at_link: semver.valid(version) ? version : "",
  };
}

/** The ref without its range, e.g. `harnesstap-cloud/default/backend-engineer`. */
export function upstreamRefBase(ref: string): string {
  const at = ref.lastIndexOf("@");
  return at > 0 ? ref.slice(0, at) : ref;
}

/** Human label: `org/catalog/slug@1.0.0`, or the raw ref when no version was recorded. */
export function formatUpstreamLabel(upstream: PluginUpstream): string {
  return upstream.version_at_link
    ? `${upstreamRefBase(upstream.ref)}@${upstream.version_at_link}`
    : upstream.ref;
}

/** What a package may carry: a complete catalog link, else nothing. */
export function exportableUpstream(upstream: PluginUpstream | undefined): PluginUpstream | undefined {
  if (!upstream || !isCatalogUpstreamRef(upstream.ref) || !semver.valid(upstream.version_at_link)) {
    return undefined;
  }
  return { kind: upstream.kind, ref: upstream.ref, version_at_link: upstream.version_at_link };
}

/** Reads `extensions["com.harnesstap"].upstream` from a package; invalid values are dropped. */
export function parseUpstream(raw: unknown): PluginUpstream | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  const ref = record.ref;
  const versionAtLink = record.version_at_link;
  if (
    typeof kind !== "string"
    || !UPSTREAM_KINDS.includes(kind as PluginUpstreamKind)
    || typeof ref !== "string"
    || typeof versionAtLink !== "string"
  ) {
    return undefined;
  }
  return exportableUpstream({
    kind: kind as PluginUpstreamKind,
    ref,
    version_at_link: versionAtLink,
  });
}

export function setPluginUpstream(
  pluginId: string,
  upstream: PluginUpstream,
  upstreamPluginId = "",
): void {
  getDb()
    .prepare(
      `UPDATE plugins
       SET upstream_kind = ?, upstream_ref = ?, upstream_version_at_link = ?, upstream_plugin_id = ?
       WHERE id = ?`,
    )
    .run(upstream.kind, upstream.ref, upstream.version_at_link, upstreamPluginId, pluginId);
}
