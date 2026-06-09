import { resolve } from "node:path";
import { resolveHomeRoot } from "../utils/home-root.js";
import { loadSettings } from "../config/settings.js";
import { getHarnessdeckDir } from "../db/connection.js";
import {
  getPluginProviders,
  getRegisteredPluginPlatformIds,
} from "../plugins/registry.js";
import {
  loadRefreshCache,
  saveRefreshCache,
} from "../plugins/refresh-cache.js";
import type {
  PluginCheckResult,
  PluginContext,
  PluginInstall,
  PluginInstallResult,
  PluginScope,
  PluginUpdateResult,
} from "../plugins/types.js";
import { installPluginPins, type InstallPluginPinResult } from "./plugin-install.js";
export interface PluginLifecycleOptions {
  projectRoot?: string;
  homeRoot?: string;
  platformIds?: string[];
  scopes?: PluginScope[];
  forceRefresh?: boolean;
}

export interface PluginListResult {
  installs: PluginInstall[];
  unsupported_platforms: string[];
}

export interface PluginCheckReport {
  refreshed_sources: string[];
  results: PluginCheckResult[];
  summary: { outdated: number; current: number; unknown: number };
  unsupported_platforms: string[];
}

export interface PluginUpdateReport {
  results: PluginUpdateResult[];
  summary: { updated: number; skipped: number; failed: number; unsupported: number };
}

function buildContext(opts: PluginLifecycleOptions): PluginContext {
  return {
    projectRoot: resolve(opts.projectRoot ?? "."),
    homeRoot: opts.homeRoot ?? resolveHomeRoot(),
    harnessdeckDir: getHarnessdeckDir(),
  };
}

function resolvePlatformIds(requested?: string[]): {
  active: string[];
  unsupported: string[];
} {
  const registered = new Set(getRegisteredPluginPlatformIds());
  if (!requested?.length) {
    return { active: [...registered], unsupported: [] };
  }
  const ids = requested.map((id) => id.trim()).filter(Boolean);
  return {
    active: ids.filter((id) => registered.has(id)),
    unsupported: ids.filter((id) => !registered.has(id)),
  };
}

export async function listPlugins(
  opts: PluginLifecycleOptions = {},
): Promise<PluginListResult> {
  const ctx = buildContext(opts);
  const { active, unsupported } = resolvePlatformIds(opts.platformIds);
  const installs: PluginInstall[] = [];
  for (const provider of getPluginProviders(active)) {
    installs.push(...(await provider.list(ctx)));
  }
  return { installs, unsupported_platforms: unsupported };
}

export async function checkPlugins(
  opts: PluginLifecycleOptions = {},
): Promise<PluginCheckReport> {
  const ctx = buildContext(opts);
  const settings = loadSettings(ctx.harnessdeckDir);
  const cache = loadRefreshCache(ctx.harnessdeckDir);
  const { active, unsupported } = resolvePlatformIds(opts.platformIds);

  const checkOpts = {
    forceRefresh: opts.forceRefresh ?? false,
    maxAgeHours: settings.plugins.refreshMaxAgeHours,
    refreshCache: cache,
    scopes: opts.scopes,
  };

  const results: PluginCheckResult[] = [];
  const refreshed_sources: string[] = [];

  for (const provider of getPluginProviders(active)) {
    const checked = await provider.check(ctx, checkOpts);
    results.push(...checked);
    for (const row of checked) {
      if (row.latestSource && !row.refreshSkipped) {
        refreshed_sources.push(row.latestSource);
      }
    }
  }

  saveRefreshCache(ctx.harnessdeckDir, checkOpts.refreshCache);

  const summary = {
    outdated: results.filter((r) => r.status === "outdated").length,
    current: results.filter((r) => r.status === "current").length,
    unknown: results.filter((r) => r.status === "unknown").length,
  };

  return {
    refreshed_sources: [...new Set(refreshed_sources)],
    results,
    summary,
    unsupported_platforms: unsupported,
  };
}

export async function updatePlugins(
  opts: PluginLifecycleOptions & { ref?: string; all?: boolean; yes?: boolean },
): Promise<PluginUpdateReport> {
  const ctx = buildContext(opts);
  const { active } = resolvePlatformIds(opts.platformIds);
  const results: PluginUpdateResult[] = [];

  const refsToUpdate: string[] = [];
  if (opts.ref) {
    refsToUpdate.push(opts.ref);
  } else if (opts.all) {
    const report = await checkPlugins({ ...opts, forceRefresh: false });
    refsToUpdate.push(
      ...report.results.filter((r) => r.status === "outdated").map((r) => r.ref),
    );
  } else {
    const report = await checkPlugins({ ...opts, forceRefresh: false });
    refsToUpdate.push(
      ...report.results.filter((r) => r.status === "outdated").map((r) => r.ref),
    );
  }

  for (const ref of refsToUpdate) {
    const installs = await listPlugins(opts);
    const install = installs.installs.find((i) => i.ref === ref);
    if (!install) continue;
    const provider = getPluginProviders(active).find(
      (p) => p.platformId === install.platformId,
    );
    if (!provider) continue;
    results.push(
      ...(await provider.update(ctx, {
        ref,
        scopes: opts.scopes ?? [install.scope],
        yes: opts.yes ?? false,
      })),
    );
  }

  return {
    results,
    summary: {
      updated: results.filter((r) => r.status === "updated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      unsupported: results.filter((r) => r.status === "unsupported").length,
    },
  };
}

export async function refreshPluginSources(
  opts: PluginLifecycleOptions = {},
): Promise<{ refreshed_sources: string[] }> {
  const report = await checkPlugins({ ...opts, forceRefresh: true });
  return { refreshed_sources: report.refreshed_sources };
}

export async function installPlugins(
  opts: PluginLifecycleOptions & {
    refs: string[];
    scope?: PluginScope;
    installPlatformId?: string;
  },
): Promise<{ results: InstallPluginPinResult[] }> {
  const pins = opts.refs.map((ref) => ({
    ref,
    version_constraint: "*",
  }));
  const results = await installPluginPins(pins, {
    homeRoot: opts.homeRoot,
    projectRoot: resolve(opts.projectRoot ?? "."),
    scope: opts.scope ?? "user",
    installPlatformId: opts.installPlatformId,
  });
  return { results };
}

export type { PluginInstallResult };
