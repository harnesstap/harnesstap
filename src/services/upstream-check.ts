import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import semver from "semver";
import { resolveCatalogScope } from "../config/catalog.js";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import { listPlugins } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { formatCatalogRequestError } from "../utils/fetch-with-timeout.js";
import { fetchCatalogPlugin } from "./catalog-client.js";
import { ensureCloudAccountAccess } from "./cloud-account-auth.js";
import { cloudFetch } from "./cloud-api-version.js";
import { resolveUpstreamParent } from "./plugin-extends.js";
import { isCatalogUpstreamRef, upstreamRange, upstreamRefBase } from "./plugin-upstream.js";

export type UpstreamCheckStatus = "current" | "update" | "major" | "unreachable" | "unpublished";

export interface UpstreamCheckRow {
  plugin_name: string;
  /** `org/catalog/slug@^1.0.0`, or `name@^1.0.0` for a local parent. */
  ref: string;
  local_version: string;
  latest_in_range: string;
  latest_major: string;
  status: UpstreamCheckStatus;
  checked_at: string;
  /** "Not now" remembers the version it dismissed. */
  dismissed_version: string;
  message: string;
}

/** What to check for one plugin: where it comes from and what it has. */
export interface UpstreamTarget {
  plugin_name: string;
  ref: string;
  local_version: string;
  /** `extends` and `fork` links, or `catalog` for a pulled package. */
  kind: "extends" | "fork" | "catalog";
}

/** What Cloud (or the fallback) knows about one catalog ref. */
export type UpstreamLatest =
  | { ok: true; latest_in_range: string; latest_major: string }
  | { ok: false; status: "unreachable" | "unpublished"; message: string };

export interface UpstreamQuery {
  /** `org/catalog/slug`. */
  base: string;
  version: string;
  range: string;
}

/** Answers keyed by `upstreamQueryKey` (ref and constraint); a key of just the ref is also read. */
export type FetchUpstreamLatest = (
  items: UpstreamQuery[],
  opts: { signal?: AbortSignal },
) => Promise<Map<string, UpstreamLatest>>;

/** Batch size of the Cloud updates-since contract. */
export const UPDATES_SINCE_BATCH = 100;

function catalogBaseOf(plugin: Plugin): string | undefined {
  const locator = plugin.origin_locator ?? "";
  const base = upstreamRefBase(locator);
  return base.split("/").length === 3 ? base : undefined;
}

/**
 * Every working head with an upstream link or a catalog origin. A pulled
 * package installed at several versions is checked once, from its newest one.
 */
export function listUpstreamTargets(): UpstreamTarget[] {
  const byKey = new Map<string, UpstreamTarget>();
  const put = (target: UpstreamTarget) => {
    const key = `${target.plugin_name}\0${target.kind === "catalog" ? upstreamRefBase(target.ref) : target.ref}`;
    const existing = byKey.get(key);
    if (
      !existing
      || (semver.valid(target.local_version)
        && semver.valid(existing.local_version)
        && semver.gt(target.local_version, existing.local_version))
    ) {
      byKey.set(key, target);
    }
  };
  for (const plugin of listPlugins()) {
    if (plugin.frozen_at) continue;
    if (plugin.upstream) {
      const parent = plugin.upstream.kind === "extends" ? resolveUpstreamParent(plugin) : undefined;
      put({
        plugin_name: plugin.name,
        ref: plugin.upstream.ref,
        local_version: parent?.version ?? plugin.upstream.version_at_link,
        kind: plugin.upstream.kind,
      });
      continue;
    }
    if (plugin.origin === "catalog") {
      const base = catalogBaseOf(plugin);
      if (!base || !semver.valid(plugin.version)) continue;
      put({
        plugin_name: plugin.name,
        ref: `${base}@${upstreamRange(plugin.version)}`,
        local_version: plugin.version,
        kind: "catalog",
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.plugin_name.localeCompare(b.plugin_name) || a.ref.localeCompare(b.ref),
  );
}

function rangeOf(ref: string): string {
  const at = ref.lastIndexOf("@");
  const range = at > 0 ? ref.slice(at + 1) : "*";
  return semver.validRange(range) ? range : "*";
}

/** Newest in range and newest above the range from a plain version list. */
export function pickLatest(
  versions: readonly string[],
  range: string,
): { latest_in_range: string; latest_major: string } {
  const valid = versions.filter((version) => semver.valid(version));
  const inRange = semver.maxSatisfying(valid, range) ?? "";
  const floor = semver.minVersion(range)?.version;
  const above = valid.filter(
    (version) => !semver.satisfies(version, range) && (!floor || semver.gt(version, floor)),
  );
  const major = above.length > 0 ? (semver.rsort([...above])[0] ?? "") : "";
  return { latest_in_range: inRange, latest_major: major };
}

export function classifyUpstream(
  localVersion: string,
  latest: UpstreamLatest,
): Pick<UpstreamCheckRow, "status" | "latest_in_range" | "latest_major" | "message"> {
  if (!latest.ok) {
    return { status: latest.status, latest_in_range: "", latest_major: "", message: latest.message };
  }
  const { latest_in_range, latest_major } = latest;
  const newer = (candidate: string) =>
    Boolean(candidate)
    && (!semver.valid(localVersion) || (semver.valid(candidate) !== null && semver.gt(candidate, localVersion)));
  if (newer(latest_in_range)) return { status: "update", latest_in_range, latest_major, message: "" };
  if (newer(latest_major)) return { status: "major", latest_in_range, latest_major, message: "" };
  return { status: "current", latest_in_range, latest_major, message: "" };
}

/** A local parent: its versions are the plugin rows that carry its name. */
function localLatest(ref: string): UpstreamLatest {
  const name = upstreamRefBase(ref);
  const versions = listPlugins()
    .filter((plugin) => plugin.name === name)
    .map((plugin) => plugin.version);
  if (versions.length === 0) {
    return { ok: false, status: "unpublished", message: `${name} is not in the Library.` };
  }
  return { ok: true, ...pickLatest(versions, rangeOf(ref)) };
}

const UPDATES_SINCE_MISSING = new Set([404, 405, 501]);

/** Map key for one query: Cloud answers per ref and constraint. */
export function upstreamQueryKey(item: Pick<UpstreamQuery, "base" | "range">): string {
  return `${item.base}@${item.range}`;
}

/** One `updates-since` answer row (harnesstap-cloud#143). */
interface UpdatesSinceItem {
  ref?: string;
  version?: string;
  constraint?: string;
  latest?: string;
  yanked?: boolean;
  latest_in_range?: string;
  latest_in_range_yanked?: boolean;
  latest_major?: string;
}

interface UpdatesSinceCache {
  [bodyKey: string]: { etag: string; items: UpdatesSinceItem[] };
}

const UPDATES_SINCE_CACHE_FILE = "updates-since.json";
const UPDATES_SINCE_CACHE_KEEP = 20;

function updatesSinceCachePath(): string {
  return join(getHarnesstapDir(), "cache", UPDATES_SINCE_CACHE_FILE);
}

function readUpdatesSinceCache(): UpdatesSinceCache {
  try {
    const parsed = JSON.parse(readFileSync(updatesSinceCachePath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as UpdatesSinceCache) : {};
  } catch {
    return {};
  }
}

/** A cache, not user data: rewritten whole, trimmed to the newest entries. */
function writeUpdatesSinceCache(cache: UpdatesSinceCache): void {
  try {
    const keys = Object.keys(cache);
    const trimmed: UpdatesSinceCache = {};
    for (const key of keys.slice(-UPDATES_SINCE_CACHE_KEEP)) trimmed[key] = cache[key]!;
    mkdirSync(dirname(updatesSinceCachePath()), { recursive: true });
    writeFileSync(updatesSinceCachePath(), JSON.stringify(trimmed));
  } catch {
    // A failed cache write only costs a full answer next time.
  }
}

/**
 * What Cloud's row means for one query. Cloud already skips yanked versions in
 * latest_in_range; the yanked flag is still honored as a safety net.
 */
export function latestFromUpdatesSince(item: UpstreamQuery, row: UpdatesSinceItem | undefined): UpstreamLatest {
  if (!row) return { ok: false, status: "unpublished", message: `${item.base} is not published.` };
  const inRange = row.latest_in_range_yanked ? "" : (row.latest_in_range ?? "");
  return { ok: true, latest_in_range: inRange, latest_major: row.latest_major ?? "" };
}

/**
 * Cloud's batched `POST /api/catalog/updates-since` (harnesstap-cloud#143):
 * `{selectors: [{ref, version, constraint}]}`, at most 100 per call, with
 * ETag and `If-None-Match` so an unchanged answer is a 304. Each item carries
 * `latest_in_range` and `latest_major`, so an update inside the range is seen
 * even when a newer major exists; "" means no update. An uncoded 404, 405 or
 * 501 (older Cloud, body not JSON or without an error code) falls back to one
 * catalog lookup per ref, which only knows each plugin's latest version. A
 * coded 404 (not_found, catalog_not_found) is a real error.
 */
export const defaultFetchUpstreamLatest: FetchUpstreamLatest = async (items, opts) => {
  const out = new Map<string, UpstreamLatest>();
  if (items.length === 0) return out;
  const root = resolveCatalogScope().cloudBaseUrl.replace(/\/+$/, "");
  let token: string | undefined;
  try {
    token = (await ensureCloudAccountAccess())?.accessToken;
  } catch {
    token = undefined;
  }
  const cache = readUpdatesSinceCache();
  let cacheChanged = false;
  for (let start = 0; start < items.length; start += UPDATES_SINCE_BATCH) {
    const batch = items.slice(start, start + UPDATES_SINCE_BATCH);
    const body = JSON.stringify({
      selectors: batch.map((item) => ({ ref: item.base, version: item.version, constraint: item.range })),
    });
    const cacheKey = `${root}\n${token ? "auth" : "public"}\n${body}`;
    const cached = cache[cacheKey];
    let response: Response;
    try {
      response = await cloudFetch(`${root}/api/catalog/updates-since`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
        },
        body,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (error) {
      for (const item of batch) {
        out.set(upstreamQueryKey(item), { ok: false, status: "unreachable", message: formatCatalogRequestError(error) });
      }
      continue;
    }
    // Only an uncoded 404/405/501 means this Cloud has no updates-since yet.
    const failure = response.ok || response.status === 304 ? undefined : await readCloudError(response);
    if (failure && UPDATES_SINCE_MISSING.has(response.status) && !failure.code) {
      for (const item of batch) out.set(upstreamQueryKey(item), await latestFromCatalogList(item));
      continue;
    }
    let rows: UpdatesSinceItem[];
    if (response.status === 304 && cached) {
      rows = cached.items;
    } else if (response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as { items?: UpdatesSinceItem[] };
      rows = Array.isArray(parsed.items) ? parsed.items : [];
      const etag = response.headers.get("etag");
      if (etag) {
        delete cache[cacheKey];
        cache[cacheKey] = { etag, items: rows };
        cacheChanged = true;
      }
    } else {
      const detail = describeCloudError(response.status, failure ?? {});
      for (const item of batch) {
        out.set(upstreamQueryKey(item), { ok: false, status: "unreachable", message: detail });
      }
      continue;
    }
    for (const item of batch) {
      const row =
        rows.find((candidate) => candidate.ref === item.base && candidate.constraint === item.range)
        ?? rows.find((candidate) => candidate.ref === item.base && candidate.constraint === undefined);
      out.set(upstreamQueryKey(item), latestFromUpdatesSince(item, row));
    }
  }
  if (cacheChanged) writeUpdatesSinceCache(cache);
  return out;
};

/**
 * Cloud error body (harnesstap-cloud#143): primary shape
 * `{"error":{code, entry?, ref?, message, requestId, fields?, details?}}`;
 * older variants (message/requestId beside `error`, `error` as a bare code)
 * are still read. `x-request-id` fills in a missing request id.
 */
export interface CloudErrorInfo {
  code?: string;
  message?: string;
  requestId?: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseCloudError(body: unknown, headers?: Headers): CloudErrorInfo {
  const top = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = top.error && typeof top.error === "object" ? (top.error as Record<string, unknown>) : {};
  return {
    code: nonEmpty(nested.code) ?? nonEmpty(top.error) ?? nonEmpty(top.code),
    message: nonEmpty(nested.message) ?? nonEmpty(top.message),
    requestId:
      nonEmpty(nested.requestId) ?? nonEmpty(top.requestId) ?? nonEmpty(headers?.get("x-request-id") ?? undefined),
  };
}

async function readCloudError(response: Response): Promise<CloudErrorInfo> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text.trim() ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return parseCloudError(body, response.headers);
}

function describeCloudError(status: number, info: CloudErrorInfo): string {
  const request = info.requestId ? ` (request ${info.requestId})` : "";
  if (info.code === "catalog_not_found") {
    return `Cloud could not find the catalog for this check${info.message ? `: ${info.message}` : "."}${request}`;
  }
  if (info.code === "not_found") {
    return `Cloud could not find what this check asked for${info.message ? `: ${info.message}` : "."}${request}`;
  }
  return [`Cloud answered ${status}`, info.message ?? info.code ?? ""].filter(Boolean).join(" ") + request;
}

/** Swappable for tests; production uses Cloud. */
export const upstreamCheckDeps: { fetchLatest: FetchUpstreamLatest } = {
  fetchLatest: defaultFetchUpstreamLatest,
};

async function latestFromCatalogList(item: UpstreamQuery): Promise<UpstreamLatest> {
  const [org = "", catalog = "", slug = ""] = item.base.split("/");
  try {
    const plugin = await fetchCatalogPlugin({ orgSlug: org, catalogSlug: catalog, slug });
    if (!plugin.latestVersion) {
      return { ok: false, status: "unpublished", message: `${item.base} has no published version.` };
    }
    return { ok: true, ...pickLatest([plugin.latestVersion], item.range) };
  } catch (error) {
    const message = formatCatalogRequestError(error);
    return /not found/i.test(message)
      ? { ok: false, status: "unpublished", message: `${item.base} is not published.` }
      : { ok: false, status: "unreachable", message };
  }
}

export interface UpstreamCheckReport {
  checked_at: string;
  rows: UpstreamCheckRow[];
}

/**
 * Ask for newer versions of every upstream and write the results in one
 * transaction. "Not now" choices survive. Rows for links that no longer
 * exist are dropped only on a full run; they are a cache, not user data.
 */
export async function runUpstreamCheck(opts?: {
  signal?: AbortSignal;
  name?: string;
  fetchLatest?: FetchUpstreamLatest;
  now?: () => Date;
}): Promise<UpstreamCheckReport> {
  const all = listUpstreamTargets();
  const targets = opts?.name ? all.filter((target) => target.plugin_name === opts.name) : all;
  const catalogQueries = new Map<string, UpstreamQuery>();
  for (const target of targets) {
    if (!isCatalogUpstreamRef(target.ref)) continue;
    const base = upstreamRefBase(target.ref);
    const query = { base, version: target.local_version, range: rangeOf(target.ref) };
    catalogQueries.set(upstreamQueryKey(query), query);
  }
  const fetchLatest = opts?.fetchLatest ?? upstreamCheckDeps.fetchLatest;
  const latestByBase = await fetchLatest([...catalogQueries.values()], { signal: opts?.signal });
  const checkedAt = (opts?.now?.() ?? new Date()).toISOString();

  const computed = targets.map((target) => {
    const base = upstreamRefBase(target.ref);
    const latest = isCatalogUpstreamRef(target.ref)
      ? (latestByBase.get(upstreamQueryKey({ base, range: rangeOf(target.ref) })) ?? latestByBase.get(base) ?? { ok: false as const, status: "unreachable" as const, message: "No answer for this ref." })
      : localLatest(target.ref);
    const known = isCatalogUpstreamRef(target.ref) && latest.ok
      ? { ok: true as const, ...narrowToRange(latest, rangeOf(target.ref)) }
      : latest;
    return {
      plugin_name: target.plugin_name,
      ref: target.ref,
      local_version: target.local_version,
      checked_at: checkedAt,
      ...classifyUpstream(target.local_version, known),
    };
  });

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO upstream_checks
       (plugin_name, ref, local_version, latest_in_range, latest_major, status, checked_at, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plugin_name, ref) DO UPDATE SET
       local_version = excluded.local_version,
       latest_in_range = excluded.latest_in_range,
       latest_major = excluded.latest_major,
       status = excluded.status,
       checked_at = excluded.checked_at,
       message = excluded.message`,
  );
  db.transaction(() => {
    for (const row of computed) {
      upsert.run(
        row.plugin_name,
        row.ref,
        row.local_version,
        row.latest_in_range,
        row.latest_major,
        row.status,
        row.checked_at,
        row.message,
      );
    }
    if (!opts?.name) {
      const keep = new Set(computed.map((row) => `${row.plugin_name}\0${row.ref}`));
      const stale = (
        db.prepare("SELECT plugin_name, ref FROM upstream_checks").all() as Array<{ plugin_name: string; ref: string }>
      ).filter((row) => !keep.has(`${row.plugin_name}\0${row.ref}`));
      const drop = db.prepare("DELETE FROM upstream_checks WHERE plugin_name = ? AND ref = ?");
      for (const row of stale) drop.run(row.plugin_name, row.ref);
    }
  })();

  const rows = readUpstreamChecks().filter(
    (row) => !opts?.name || row.plugin_name === opts.name,
  );
  return { checked_at: checkedAt, rows };
}

/** Cloud answers per base; a child's own range can be narrower than another child's. */
function narrowToRange(
  latest: { latest_in_range: string; latest_major: string },
  range: string,
): { latest_in_range: string; latest_major: string } {
  return pickLatest([latest.latest_in_range, latest.latest_major].filter(Boolean), range);
}

/** The table as is. No network. */
export function readUpstreamChecks(): UpstreamCheckRow[] {
  return getDb()
    .prepare("SELECT * FROM upstream_checks ORDER BY plugin_name, ref")
    .all() as UpstreamCheckRow[];
}

/** An update the user has not set aside with "Not now" at that version. */
export function isPendingUpdate(row: Pick<UpstreamCheckRow, "status" | "latest_in_range" | "latest_major" | "dismissed_version">): boolean {
  if (row.status === "update") return row.dismissed_version !== row.latest_in_range;
  if (row.status === "major") return row.dismissed_version !== row.latest_major;
  return false;
}

export interface UpstreamCheckSummary {
  count: number;
  major_count: number;
  items: Array<Pick<UpstreamCheckRow, "plugin_name" | "ref" | "local_version" | "latest_in_range" | "latest_major" | "status">>;
}

/**
 * Counts for status and the banner, from the status index only. Dismissed
 * versions are left out; a newer version shows up again.
 */
export function readUpstreamCheckSummary(limit = 5): UpstreamCheckSummary {
  const rows = getDb()
    .prepare(
      `SELECT plugin_name, ref, local_version, latest_in_range, latest_major, status, dismissed_version
       FROM upstream_checks WHERE status IN ('update', 'major') ORDER BY plugin_name, ref`,
    )
    .all() as UpstreamCheckRow[];
  const pending = rows.filter(isPendingUpdate);
  const updates = pending.filter((row) => row.status === "update");
  const majors = pending.filter((row) => row.status === "major");
  return {
    count: updates.length,
    major_count: majors.length,
    items: [...updates, ...majors].slice(0, limit).map(
      ({ plugin_name, ref, local_version, latest_in_range, latest_major, status }) => ({
        plugin_name,
        ref,
        local_version,
        latest_in_range,
        latest_major,
        status,
      }),
    ),
  };
}

/**
 * "Not now": hide this plugin's pending update at `version` (default: the
 * version on offer). A newer version shows up again.
 */
export function dismissUpstreamUpdate(pluginName: string, version?: string): UpstreamCheckRow[] {
  const db = getDb();
  const rows = (
    db.prepare("SELECT * FROM upstream_checks WHERE plugin_name = ?").all(pluginName) as UpstreamCheckRow[]
  ).filter((row) => row.status === "update" || row.status === "major");
  if (rows.length === 0) {
    throw new Error(`No pending update for ${pluginName}.`);
  }
  const set = db.prepare("UPDATE upstream_checks SET dismissed_version = ? WHERE plugin_name = ? AND ref = ?");
  db.transaction(() => {
    for (const row of rows) {
      set.run(version ?? (row.status === "update" ? row.latest_in_range : row.latest_major), pluginName, row.ref);
    }
  })();
  return db.prepare("SELECT * FROM upstream_checks WHERE plugin_name = ?").all(pluginName) as UpstreamCheckRow[];
}
