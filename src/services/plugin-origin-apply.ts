import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import {
  addResourceToPlugin,
  assertNoFrozenWorkingVersion,
  bumpPluginWorkingVersion,
  getPluginById,
  getPluginResources,
  removeResourceFromPlugin,
  stampPluginOrigin,
} from "../models/plugin-model.js";
import { deleteResource, upsertResource } from "../models/resource.js";
import {
  MATERIAL_RESOURCE_TYPES,
  type OriginFingerprintKind,
  type Plugin,
  type ResourceCreateInput,
  type ResourceType,
} from "../types.js";
import { parseApPackageFiles } from "./agent-plugins/import.js";
import type { ApPackageFiles } from "./agent-plugins/files.js";
import { downloadCatalogPackage } from "./catalog-client.js";
import { marketplaceCacheDir } from "./marketplace-catalog.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import {
  formatOriginLocator,
  parseOriginLocator,
  recoverOriginLocator,
  type OriginLocator,
} from "./plugin-origin-locator.js";
import { scanPluginSource } from "./plugin-source-import.js";

export type PluginOriginApplyDeps = {
  downloadCatalogPackage?: (input: {
    orgSlug: string;
    catalogSlug?: string;
    pluginSlug: string;
    version?: string;
  }) => Promise<{ version: string; files: ApPackageFiles }>;
};

export type OriginApplyCheck = {
  origin_locator: string;
  origin_version?: string;
  origin_fingerprint?: string;
};

export type PluginOriginUpdateStatus = "updated" | "skipped" | "failed";

export type PluginOriginUpdateRow = {
  plugin_id: string;
  name: string;
  status: PluginOriginUpdateStatus;
  message?: string;
  local_version?: string;
};

export type PluginOriginUpdateReport = {
  results: PluginOriginUpdateRow[];
  summary: { updated: number; skipped: number; failed: number };
};

const MATERIAL_TYPES = new Set<string>(MATERIAL_RESOURCE_TYPES);

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function resolveMarketplacePluginDirectory(
  cacheDir: string,
  pluginName: string,
): string | undefined {
  const underPlugins = join(cacheDir, "plugins", pluginName);
  if (isDirectory(underPlugins)) return underPlugins;

  const atRoot = join(cacheDir, pluginName);
  if (isDirectory(atRoot)) return atRoot;

  if (!isDirectory(cacheDir)) return undefined;

  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }
    const nested = join(cacheDir, entry.name, pluginName);
    if (isDirectory(nested)) return nested;
  }
  return undefined;
}

export function gitOriginCacheDir(harnesstapDir: string, url: string): string {
  const digest = createHash("sha256").update(url, "utf8").digest("hex");
  return join(harnesstapDir, "cache", "git-origins", digest);
}

function originPluginLookupName(plugin: Plugin, locator: OriginLocator): string {
  switch (locator.kind) {
    case "marketplace":
      return parseDependencyRef(locator.ref).name;
    case "git":
      return plugin.name;
    case "catalog":
      return locator.slug;
    default: {
      const _exhaustive: never = locator;
      throw new Error(`Unhandled origin locator: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveCachedPluginDir(
  cacheDir: string,
  plugin: Plugin,
  locator: OriginLocator,
): string | undefined {
  const names = [originPluginLookupName(plugin, locator), plugin.name];
  const seen = new Set<string>();
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const found = resolveMarketplacePluginDirectory(cacheDir, name);
    if (found) return found;
  }
  return undefined;
}

function resourceKey(resource: { type: ResourceType; name: string }): string {
  return `${resource.type}:${resource.name}`;
}

function remainingAttachers(resourceId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM plugin_resources WHERE resource_id = ?")
    .get(resourceId) as { n: number };
  return row.n;
}

function replacePluginAttachments(
  pluginId: string,
  resources: ResourceCreateInput[],
  locatorStr: string,
): void {
  const keep = new Set<string>();
  for (const resource of resources) {
    if (!MATERIAL_TYPES.has(resource.type)) continue;
    const result = upsertResource(
      {
        type: resource.type,
        name: resource.name,
        namespace: resource.namespace ?? "",
        description: resource.description,
        content: resource.content,
        metadata: resource.metadata,
        source: resource.source,
        origin_kind: "marketplace_link",
        origin_ref: locatorStr,
      },
      { policy: "overwrite" },
    );
    const upserted =
      result.action === "skipped" ? result.existing : result.resource;
    addResourceToPlugin(pluginId, upserted.id);
    keep.add(resourceKey(resource));
  }

  for (const attached of getPluginResources(pluginId)) {
    if (!MATERIAL_TYPES.has(attached.type)) continue;
    if (keep.has(resourceKey(attached))) continue;
    removeResourceFromPlugin(pluginId, attached.id);
    if (remainingAttachers(attached.id) === 0) {
      deleteResource(attached.id);
    }
  }
}

function fingerprintKindFor(
  locator: OriginLocator,
  fingerprint: string,
  originVersion?: string,
): OriginFingerprintKind {
  switch (locator.kind) {
    case "marketplace":
    case "git":
      return "git_sha";
    case "catalog":
      return fingerprint && originVersion && fingerprint !== originVersion
        ? "catalog_digest"
        : "catalog_version";
    default: {
      const _exhaustive: never = locator;
      throw new Error(`Unhandled origin locator: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function applyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!/401/.test(message)) return message;
  if (/sign in/i.test(message)) return message;
  return `${message}; sign in required to update this catalog plugin`;
}

function updateRow(
  plugin: Plugin,
  status: PluginOriginUpdateStatus,
  extra?: { message?: string; local_version?: string },
): PluginOriginUpdateRow {
  return {
    plugin_id: plugin.id,
    name: plugin.name,
    status,
    local_version: extra?.local_version ?? plugin.version,
    ...(extra?.message ? { message: extra.message } : {}),
  };
}

async function scanMarketplaceOrGit(
  pluginDir: string,
  pluginName: string,
): Promise<{ version?: string; resources: ResourceCreateInput[] }> {
  const scans = await scanPluginSource(pluginDir);
  const scan = scans.find((entry) => entry.plugin_name === pluginName) ?? scans[0];
  if (!scan) {
    throw new Error(`No plugin source found at ${pluginDir}`);
  }
  return { version: scan.plugin_version, resources: scan.resources };
}

export async function applyCheckedPluginOrigin(
  plugin: Plugin,
  check: OriginApplyCheck,
  deps?: PluginOriginApplyDeps,
): Promise<PluginOriginUpdateRow> {
  const locator =
    recoverOriginLocator(plugin) ?? parseOriginLocator(check.origin_locator);
  if (!locator) {
    throw new Error("Cannot apply origin update without a locator");
  }
  const locatorStr = formatOriginLocator(locator);
  const fingerprint = check.origin_fingerprint ?? "";
  const harnesstapDir = getHarnesstapDir();

  let nextVersion: string;
  let resources: ResourceCreateInput[];

  switch (locator.kind) {
    case "marketplace": {
      const parsed = parseDependencyRef(locator.ref);
      const cacheDir = marketplaceCacheDir(harnesstapDir, parsed.namespace);
      const pluginDir = resolveCachedPluginDir(cacheDir, plugin, locator);
      if (!pluginDir) {
        throw new Error(`Could not resolve marketplace plugin directory for ${plugin.name}`);
      }
      const scanned = await scanMarketplaceOrGit(pluginDir, plugin.name);
      resources = scanned.resources;
      nextVersion = scanned.version || fingerprint.slice(0, 12);
      break;
    }
    case "git": {
      const cacheDir = gitOriginCacheDir(harnesstapDir, locator.url);
      const pluginDir = resolveCachedPluginDir(cacheDir, plugin, locator);
      if (!pluginDir) {
        throw new Error(`Could not resolve git plugin directory for ${plugin.name}`);
      }
      const scanned = await scanMarketplaceOrGit(pluginDir, plugin.name);
      resources = scanned.resources;
      nextVersion = scanned.version || fingerprint.slice(0, 12);
      break;
    }
    case "catalog": {
      const download = deps?.downloadCatalogPackage ?? downloadCatalogPackage;
      const pkg = await download({
        orgSlug: locator.org,
        catalogSlug: locator.catalog,
        pluginSlug: locator.slug,
        version: check.origin_version,
      });
      const parsed = parseApPackageFiles(pkg.files);
      resources = parsed.resources;
      nextVersion = parsed.version;
      break;
    }
    default: {
      const _exhaustive: never = locator;
      throw new Error(`Unhandled origin locator: ${JSON.stringify(_exhaustive)}`);
    }
  }

  if (!nextVersion) {
    throw new Error(`Origin did not provide a version for ${plugin.name}`);
  }

  assertNoFrozenWorkingVersion(plugin, nextVersion);
  replacePluginAttachments(plugin.id, resources, locatorStr);
  bumpPluginWorkingVersion(plugin.id, nextVersion);
  stampPluginOrigin(plugin.id, {
    locator: locatorStr,
    fingerprint: fingerprint || undefined,
    fingerprintKind: fingerprintKindFor(locator, fingerprint, check.origin_version),
  });

  const after = getPluginById(plugin.id) ?? plugin;
  return updateRow(after, "updated", { local_version: after.version });
}

export function originApplyFailureRow(plugin: Plugin, error: unknown): PluginOriginUpdateRow {
  return updateRow(plugin, "failed", { message: applyErrorMessage(error) });
}

export function originSkipRow(
  plugin: Plugin,
  message?: string,
): PluginOriginUpdateRow {
  return updateRow(plugin, "skipped", message ? { message } : undefined);
}

export function originFailRow(plugin: Plugin, message?: string): PluginOriginUpdateRow {
  return updateRow(plugin, "failed", message ? { message } : undefined);
}

export function summarizeOriginUpdate(
  results: PluginOriginUpdateRow[],
): PluginOriginUpdateReport["summary"] {
  const summary = { updated: 0, skipped: 0, failed: 0 };
  for (const row of results) {
    switch (row.status) {
      case "updated":
        summary.updated += 1;
        break;
      case "skipped":
        summary.skipped += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      default: {
        const _exhaustive: never = row.status;
        throw new Error(`Unhandled update status: ${_exhaustive}`);
      }
    }
  }
  return summary;
}
