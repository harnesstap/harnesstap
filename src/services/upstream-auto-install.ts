import semver from "semver";
import { getDb } from "../db/connection.js";
import { getPluginById, getPluginResources, listPlugins } from "../models/plugin-model.js";
import { MATERIAL_RESOURCE_TYPES, type Plugin } from "../types.js";
import { getActiveProfileName } from "./active-profile.js";
import { parseApPackageFiles } from "./agent-plugins/import.js";
import type { ApPackageFiles } from "./agent-plugins/files.js";
import { downloadCatalogPackage } from "./catalog-client.js";
import { listComposedDependencies } from "./plugin-extends.js";
import { applyCheckedPluginOrigin } from "./plugin-origin-apply.js";
import { formatOriginLocator, recoverOriginLocator } from "./plugin-origin-locator.js";
import { cutPluginVersion } from "./plugin-versioning.js";
import { upstreamRefBase } from "./plugin-upstream.js";
import { readUpstreamChecks, type UpstreamCheckRow } from "./upstream-check-read.js";
import { notifySafely } from "./notifications.js";
import { upstreamRefRange } from "./upstream-check.js";

export type AutoInstallStatus = "installed" | "skipped" | "failed";

export interface AutoInstallRow {
  plugin_name: string;
  from: string;
  to: string;
  status: AutoInstallStatus;
  message?: string;
  /** The active profile was re-applied through the normal apply path. */
  applied?: boolean;
}

export interface AutoInstallDeps {
  downloadCatalogPackage: (input: {
    orgSlug: string;
    catalogSlug?: string;
    pluginSlug: string;
    version?: string;
  }) => Promise<{ version: string; files: ApPackageFiles }>;
  activeProfileName: () => string | undefined;
  /** True when live harness files differ from what the active profile wrote. */
  activeProfileDrifted: () => Promise<boolean>;
  /** Normal apply of the active profile; it stops on any conflict. */
  applyActiveProfile: (name: string) => Promise<"applied" | "cancelled">;
}

const defaultDeps: AutoInstallDeps = {
  downloadCatalogPackage: (input) => downloadCatalogPackage(input),
  activeProfileName: () => getActiveProfileName(),
  activeProfileDrifted: async () => {
    const { detectGlobalProfileStatus } = await import("./global-profile-drift.js");
    return (await detectGlobalProfileStatus()).has_drift;
  },
  applyActiveProfile: async (name) => {
    const { useProfileCommand } = await import("./profile-commands.js");
    const result = await useProfileCommand(name, {
      conflictPolicy: "cancel",
      yes: true,
      interactive: false,
    });
    return result.cancelled ? "cancelled" : "applied";
  },
};

export const SKIP_MAJOR = "major version; never installed automatically";
export const SKIP_LOCAL_EDITS = "has local edits; install skipped";
export const SKIP_NOT_CATALOG = "not a pulled catalog plugin";
export const SKIP_ACTIVE_DRIFT = "installed; the active profile has local changes, so it was not re-applied";

/**
 * Only a newer minor or patch inside the link's caret range qualifies. A
 * major, a prerelease, a downgrade or anything outside the range never does.
 */
export function isAutoInstallable(local: string, target: string, ref: string): boolean {
  if (!semver.valid(local) || !semver.valid(target)) return false;
  if (semver.prerelease(target)) return false;
  if (!semver.gt(target, local)) return false;
  if (semver.major(target) !== semver.major(local)) return false;
  return semver.satisfies(target, upstreamRefRange(ref));
}

function workingHead(name: string): Plugin | undefined {
  return listPlugins().find((plugin) => plugin.name === name && !plugin.frozen_at);
}

function hasFrozenCut(plugin: Plugin, version: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM plugins WHERE name = ? AND org_slug = ? AND catalog_slug = ?
       AND version = ? AND frozen_at IS NOT NULL LIMIT 1`,
    )
    .get(plugin.name, plugin.org_slug, plugin.catalog_slug, version);
  return Boolean(row);
}

const MATERIAL = new Set<string>(MATERIAL_RESOURCE_TYPES);

type SignedResource = {
  type: string;
  name: string;
  namespace?: string;
  content: string;
  metadata?: unknown;
};

/** Material resources by body, plus plugin dependencies by name and constraint. */
function contentSignature(resources: SignedResource[], dependencies?: Array<{ name: string; constraint?: string }>): string {
  const lines = resources
    .filter((resource) => MATERIAL.has(resource.type))
    .map((resource) => `${resource.type}\u0000${resource.namespace ?? ""}\u0000${resource.name}\u0000${resource.content}`);
  if (dependencies) {
    lines.push(...dependencies.map((dependency) => `plugin\u0000${dependency.name}\u0000${dependency.constraint ?? ""}`));
  } else {
    for (const resource of resources) {
      if (resource.type !== "plugin") continue;
      const metadata = (resource.metadata ?? {}) as { version_constraint?: unknown };
      const constraint = typeof metadata.version_constraint === "string" && metadata.version_constraint
        ? metadata.version_constraint
        : (resource.namespace ?? "");
      lines.push(`plugin\u0000${resource.name}\u0000${constraint}`);
    }
  }
  return lines.sort().join("\u0001");
}

function activeProfileUses(active: string | undefined, pluginName: string, ref: string): boolean {
  if (!active) return false;
  if (active === pluginName) return true;
  const profile = workingHead(active);
  if (!profile) return false;
  try {
    const base = upstreamRefBase(ref);
    return listComposedDependencies(profile.id).some(
      (dependency) => dependency.name === pluginName || dependency.name === base,
    );
  } catch {
    return false;
  }
}

/**
 * Library resources are shared by type, name and namespace. An unattended
 * install never rewrites one that another plugin also uses.
 */
function sharedResourceChange(
  pluginName: string,
  resources: Array<{ type: string; name: string; namespace?: string; content: string }>,
): { key: string; owner: string } | null {
  const db = getDb();
  const find = db.prepare("SELECT id, content FROM resources WHERE type = ? AND name = ? AND namespace = ?");
  const owners = db.prepare(
    `SELECT DISTINCT p.name FROM plugin_resources pr JOIN plugins p ON p.id = pr.plugin_id
     WHERE pr.resource_id = ? AND p.name != ?`,
  );
  for (const resource of resources) {
    const existing = find.get(resource.type, resource.name, resource.namespace ?? "") as
      | { id: string; content: string }
      | undefined;
    if (!existing || existing.content === resource.content) continue;
    const other = owners.get(existing.id, pluginName) as { name: string } | undefined;
    if (other) return { key: `${resource.type}:${resource.name}`, owner: other.name };
  }
  return null;
}

async function installOne(
  row: UpstreamCheckRow,
  deps: AutoInstallDeps,
): Promise<AutoInstallRow> {
  const base: AutoInstallRow = {
    plugin_name: row.plugin_name,
    from: row.local_version,
    to: row.latest_in_range,
    status: "skipped",
  };
  if (!isAutoInstallable(row.local_version, row.latest_in_range, row.ref)) {
    return { ...base, to: row.latest_major || row.latest_in_range, message: SKIP_MAJOR };
  }
  const plugin = workingHead(row.plugin_name);
  if (!plugin || plugin.upstream || plugin.origin !== "catalog") {
    return { ...base, message: SKIP_NOT_CATALOG };
  }
  if (plugin.version !== row.local_version) {
    return { ...base, from: plugin.version, message: "changed since the last check; install skipped" };
  }
  const locator = recoverOriginLocator(plugin);
  if (!locator || locator.kind !== "catalog") {
    return { ...base, message: SKIP_NOT_CATALOG };
  }

  // Local edits: the head no longer matches the published package of its
  // version. The `dirty` flag cannot tell, since a fresh pull sets it.
  try {
    const installed = await deps.downloadCatalogPackage({
      orgSlug: locator.org,
      catalogSlug: locator.catalog,
      pluginSlug: locator.slug,
      version: plugin.version,
    });
    const parsedInstalled = parseApPackageFiles(installed.files);
    const published = contentSignature(parsedInstalled.resources, parsedInstalled.dependencies ?? []);
    if (published !== contentSignature(getPluginResources(plugin.id))) {
      return { ...base, message: SKIP_LOCAL_EDITS };
    }
  } catch (error) {
    return {
      ...base,
      message: `could not compare with the published ${plugin.version} (${error instanceof Error ? error.message : String(error)}); install skipped`,
    };
  }

  // Download first, so a failed fetch leaves the library untouched.
  let pkg: { version: string; files: ApPackageFiles };
  try {
    pkg = await deps.downloadCatalogPackage({
      orgSlug: locator.org,
      catalogSlug: locator.catalog,
      pluginSlug: locator.slug,
      version: row.latest_in_range,
    });
  } catch (error) {
    return { ...base, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  const parsedPkg = parseApPackageFiles(pkg.files);
  const delivered = parsedPkg.version;
  if (delivered !== row.latest_in_range || !isAutoInstallable(plugin.version, delivered, row.ref)) {
    return {
      ...base,
      status: "failed",
      message: `the catalog sent ${delivered || "no version"} instead of ${row.latest_in_range}; nothing installed`,
    };
  }

  const shared = sharedResourceChange(plugin.name, parsedPkg.resources);
  if (shared) {
    return { ...base, message: `would change ${shared.key}, which ${shared.owner} also uses; install skipped` };
  }

  try {
    // Keep the installed version as a frozen cut next to the new one.
    if (!hasFrozenCut(plugin, plugin.version)) {
      cutPluginVersion({ pluginId: plugin.id, newVersion: row.latest_in_range });
    }
    const head = getPluginById(plugin.id) ?? plugin;
    await applyCheckedPluginOrigin(
      head,
      {
        origin_locator: formatOriginLocator(locator),
        origin_version: row.latest_in_range,
        origin_fingerprint: row.latest_in_range,
      },
      { downloadCatalogPackage: async () => pkg },
    );
  } catch (error) {
    return { ...base, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  getDb()
    .prepare("UPDATE upstream_checks SET local_version = ?, status = 'current' WHERE plugin_name = ? AND ref = ?")
    .run(row.latest_in_range, row.plugin_name, row.ref);
  return { ...base, status: "installed" };
}

/**
 * Install mode: bring pulled catalog plugins up to the newest minor or patch
 * inside their range, from the stored check. Never a major, never a plugin
 * with local edits, never a separate copy. Nothing is deleted: the previous
 * version stays as a frozen cut. The active profile is re-applied only when
 * its harness files are clean, and the apply stops on any conflict.
 */
export async function runAutoInstall(opts?: { deps?: Partial<AutoInstallDeps> }): Promise<AutoInstallRow[]> {
  const deps: AutoInstallDeps = { ...defaultDeps, ...opts?.deps };
  const rows = readUpstreamChecks().filter(
    (row) => row.status === "update" || row.status === "major",
  );
  const results: AutoInstallRow[] = [];
  for (const row of rows) {
    results.push(await installOne(row, deps));
  }

  const active = deps.activeProfileName();
  const refOf = (name: string) => rows.find((row) => row.plugin_name === name)?.ref ?? "";
  const touching = results.filter(
    (result) => result.status === "installed" && activeProfileUses(active, result.plugin_name, refOf(result.plugin_name)),
  );
  if (active && touching.length > 0) {
    let outcome: "applied" | "cancelled" | "drifted";
    try {
      outcome = (await deps.activeProfileDrifted()) ? "drifted" : await deps.applyActiveProfile(active);
    } catch {
      outcome = "cancelled";
    }
    for (const result of touching) {
      if (outcome === "applied") {
        result.applied = true;
      } else {
        result.applied = false;
        result.message = outcome === "drifted"
          ? SKIP_ACTIVE_DRIFT
          : "installed; re-applying the active profile stopped on a conflict, nothing was overwritten";
      }
    }
  }
  for (const result of results) {
    if (result.status !== "installed") continue;
    notifySafely({
      kind: "auto_installed",
      plugin_name: result.plugin_name,
      title: `${result.plugin_name} updated to ${result.to}`,
      body: result.message
        ? `Installed automatically. ${result.from} kept so you can roll back. ${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}.`
        : `Installed automatically. ${result.from} kept so you can roll back.`,
      payload: { version: result.to, from: result.from, applied: result.applied ?? false },
    });
  }
  return results;
}
