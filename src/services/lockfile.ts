import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPluginResources } from "../models/plugin-model.js";
import { formatTransportToml, parseTransportToml } from "./toml/index.js";
import { resourceFingerprint } from "./resolve/resource-resolution.js";
import { resolutionKey } from "./resolve/resource-resolution.js";
import type { ResolutionResult } from "./resolve/types.js";
import type { Resource } from "../types.js";

export const LOCK_SCHEMA = "urn:harnesstap:lock:v1";
export const LOCK_SCHEMA_VERSION = 1;

export type LockSource = "local" | "marketplace" | "git" | "catalog";

export interface LockEntry {
  name: string;
  version: string;
  source: LockSource;
  /** Hash over the plugin's attached resource fingerprints. */
  integrity: string;
  depth: number;
  /** Dependency path from the root that selected this version. */
  path: string[];
}

export interface Lockfile {
  root: string;
  resolved_at: string;
  /** Hash over the resolved `type:name` → fingerprint map, for drift detection. */
  resource_map_hash: string;
  plugins: LockEntry[];
}

export function lockfilePath(projectRoot: string): string {
  return join(projectRoot, ".harnesstap", "lock.toml");
}

export function resourceMapHash(resources: Resource[]): string {
  const entries = resources
    .map((resource) => `${resolutionKey(resource)}=${resourceFingerprint(resource)}`)
    .sort();
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

export function pluginIntegrity(pluginId: string): string {
  const entries = getPluginResources(pluginId)
    .map((resource) => `${resolutionKey(resource)}=${resourceFingerprint(resource)}`)
    .sort();
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

export function lockfileFromResolution(result: ResolutionResult): Lockfile {
  return {
    root: result.root.name,
    resolved_at: new Date().toISOString(),
    resource_map_hash: resourceMapHash(result.resources),
    plugins: result.selected
      .filter((plugin) => plugin.depth > 0)
      .map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        source: plugin.source,
        integrity: pluginIntegrity(plugin.pluginId),
        depth: plugin.depth,
        path: plugin.path,
      })),
  };
}

export function writeLockfile(projectRoot: string, lock: Lockfile): void {
  const path = lockfilePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    formatTransportToml({
      schema: LOCK_SCHEMA,
      version: LOCK_SCHEMA_VERSION,
      root: lock.root,
      resolved_at: lock.resolved_at,
      resource_map_hash: lock.resource_map_hash,
      plugins: lock.plugins.map((entry) => ({ ...entry })),
    }),
    "utf8",
  );
}

export function readLockfile(projectRoot: string): Lockfile | undefined {
  const path = lockfilePath(projectRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  const document = parseTransportToml(readFileSync(path, "utf8"), "lockfile");
  if (document.schema !== LOCK_SCHEMA) {
    throw new Error(
      `Unsupported lockfile schema: ${String(document.schema)}. Expected ${LOCK_SCHEMA}. ` +
        "Delete .harnesstap/lock.toml and re-run apply to regenerate it.",
    );
  }
  const plugins = Array.isArray(document.plugins)
    ? (document.plugins as Array<Record<string, unknown>>)
    : [];
  return {
    root: String(document.root ?? ""),
    resolved_at: String(document.resolved_at ?? ""),
    resource_map_hash: String(document.resource_map_hash ?? ""),
    plugins: plugins.map((entry) => ({
      name: String(entry.name ?? ""),
      version: String(entry.version ?? ""),
      source: (entry.source as LockSource) ?? "local",
      integrity: String(entry.integrity ?? ""),
      depth: Number(entry.depth ?? 1),
      path: Array.isArray(entry.path) ? (entry.path as string[]) : [],
    })),
  };
}

export function lockedVersionsFrom(lock: Lockfile): Map<string, string> {
  return new Map(lock.plugins.map((entry) => [entry.name, entry.version]));
}

export function lockfileMatchesResolution(
  lock: Lockfile,
  result: ResolutionResult,
): boolean {
  if (lock.root !== result.root.name) return false;
  if (lock.resource_map_hash !== resourceMapHash(result.resources)) return false;
  const resolved = new Map(
    result.selected.filter((p) => p.depth > 0).map((p) => [p.name, p.version]),
  );
  if (resolved.size !== lock.plugins.length) return false;
  return lock.plugins.every((entry) => resolved.get(entry.name) === entry.version);
}

/**
 * True when every locked plugin is still available at the locked version.
 * A stale lock falls back to a full re-resolution rather than failing.
 */
export function lockIsUsable(lock: Lockfile, rootName: string): boolean {
  return lock.root === rootName && lock.plugins.every((entry) => entry.version !== "");
}

export interface LockDrift {
  drift: boolean;
  root: string;
  changes: Array<{ name: string; locked: string; resolved: string }>;
  added: string[];
  removed: string[];
}

export function compareLockToResolution(
  lock: Lockfile,
  result: ResolutionResult,
): LockDrift {
  const lockedByName = new Map(lock.plugins.map((entry) => [entry.name, entry.version]));
  const resolvedByName = new Map(
    result.selected.filter((p) => p.depth > 0).map((p) => [p.name, p.version]),
  );

  const changes: LockDrift["changes"] = [];
  for (const [name, locked] of lockedByName) {
    const resolved = resolvedByName.get(name);
    if (resolved !== undefined && resolved !== locked) {
      changes.push({ name, locked, resolved });
    }
  }
  const added = [...resolvedByName.keys()].filter((name) => !lockedByName.has(name));
  const removed = [...lockedByName.keys()].filter((name) => !resolvedByName.has(name));
  const resourceDrift = lock.resource_map_hash !== resourceMapHash(result.resources);

  return {
    drift: changes.length > 0 || added.length > 0 || removed.length > 0 || resourceDrift,
    root: lock.root,
    changes,
    added,
    removed,
  };
}
