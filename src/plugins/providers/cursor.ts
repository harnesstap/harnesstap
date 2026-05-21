import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getSourcesToRefresh,
  markSourceRefreshed,
} from "../refresh-cache.js";
import {
  cursorCacheRoot,
  cursorRepoSourceKey,
  refreshGitSource,
} from "../refresh.js";
import { defaultRunCommand, type RunCommand } from "../run-command.js";
import type {
  PluginCheckOptions,
  PluginCheckResult,
  PluginContext,
  PluginInstall,
  PluginProvider,
  PluginUpdateOptions,
  PluginUpdateResult,
} from "../types.js";

interface CursorPluginManifest {
  name: string;
  version?: string;
  description?: string;
  repository?: string;
  homepage?: string;
}

export interface CursorProviderDeps {
  runCommand?: RunCommand;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function scanCursorCache(homeRoot: string): PluginInstall[] {
  const cacheRoot = cursorCacheRoot(homeRoot);
  if (!existsSync(cacheRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const marketplace of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const marketplaceDir = join(cacheRoot, marketplace.name);
    for (const pluginDir of readdirSync(marketplaceDir, { withFileTypes: true })) {
      if (!pluginDir.isDirectory()) continue;
      const pluginPath = join(marketplaceDir, pluginDir.name);
      for (const versionDir of readdirSync(pluginPath, { withFileTypes: true })) {
        if (!versionDir.isDirectory()) continue;
        const installPath = join(pluginPath, versionDir.name);
        const manifest = readJson<CursorPluginManifest>(
          join(installPath, ".cursor-plugin", "plugin.json"),
        );
        if (!manifest?.name) continue;
        const ref = `${manifest.name}@${marketplace.name}`;
        installs.push({
          ref,
          platformId: "cursor",
          name: manifest.name,
          version: manifest.version ?? versionDir.name,
          versionSource: manifest.version ? "manifest" : "git_sha",
          scope: "user",
          enabled: true,
          installPath,
          metadata: {
            description: manifest.description,
            repository: manifest.repository,
            homepage: manifest.homepage,
          },
        });
      }
    }
  }
  return installs;
}

export class CursorPluginProvider implements PluginProvider {
  readonly platformId = "cursor";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    updateMethod: "git" as const,
  };

  constructor(private readonly deps: CursorProviderDeps = {}) {}

  async list(ctx: PluginContext): Promise<PluginInstall[]> {
    return scanCursorCache(ctx.homeRoot);
  }

  async check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]> {
    const installs = scanCursorCache(ctx.homeRoot);
    const results: PluginCheckResult[] = [];

    for (const install of installs) {
      if (opts.scopes && !opts.scopes.includes(install.scope)) continue;
      const repo = install.metadata?.repository;
      if (!repo) {
        results.push({
          ...install,
          status: "unknown",
          message: "No repository URL; update via Cursor IDE",
          refreshSkipped: true,
        });
        continue;
      }

      const sourceKey = cursorRepoSourceKey(repo);
      const shouldRefresh = getSourcesToRefresh(
        [sourceKey],
        opts.refreshCache,
        opts.maxAgeHours,
        opts.forceRefresh,
      ).includes(sourceKey);

      let latestVersion: string | undefined;
      if (shouldRefresh) {
        const tmpParent = join(ctx.harnessdeckDir, "tmp-refresh");
        const refresh = refreshGitSource({
          url: repo,
          targetDir: join(tmpParent, install.name),
          runCommand: this.deps.runCommand,
        });
        if (refresh.ok && refresh.sha) {
          latestVersion = refresh.sha.slice(0, 12);
          Object.assign(
            opts.refreshCache,
            markSourceRefreshed(opts.refreshCache, sourceKey),
          );
        }
      }

      const installedHash = install.installPath?.split("/").pop();
      const status: PluginCheckResult["status"] =
        latestVersion && installedHash
          ? latestVersion === installedHash.slice(0, 12) ||
              installedHash.startsWith(latestVersion)
            ? "current"
            : "outdated"
          : "unknown";

      results.push({
        ...install,
        status,
        latestVersion,
        latestSource: sourceKey,
        refreshSkipped: !shouldRefresh,
      });
    }
    return results;
  }

  async update(
    ctx: PluginContext,
    opts: PluginUpdateOptions,
  ): Promise<PluginUpdateResult[]> {
    const installs = scanCursorCache(ctx.homeRoot);
    const targets = opts.ref
      ? installs.filter((i) => i.ref === opts.ref)
      : installs;
    const results: PluginUpdateResult[] = [];

    for (const install of targets) {
      const repo = install.metadata?.repository;
      if (!repo) {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "unsupported",
          message: "No repository URL; update via Cursor IDE",
        });
        continue;
      }
      if (!install.installPath) {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "failed",
          message: "Missing install path",
        });
        continue;
      }

      const parent = join(install.installPath, "..");
      const refresh = refreshGitSource({
        url: repo,
        targetDir: join(parent, ".refresh-staging"),
        runCommand: this.deps.runCommand,
      });
      if (!refresh.ok || !refresh.sha) {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "failed",
          previousVersion: install.version,
          message: refresh.message,
        });
        continue;
      }

      const newDir = join(parent, refresh.sha.slice(0, 12));
      const staging = join(parent, ".refresh-staging");
      const move = (this.deps.runCommand ?? defaultRunCommand)("mv", [
        staging,
        newDir,
      ]);
      if (move.exitCode !== 0) {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "failed",
          message: move.stderr.trim() || "Failed to move refreshed plugin",
        });
        continue;
      }

      results.push({
        ref: install.ref,
        platformId: this.platformId,
        scope: install.scope,
        status: "updated",
        previousVersion: install.version,
        newVersion: refresh.sha.slice(0, 12),
        message: "Refreshed from git repository",
      });
    }
    return results;
  }
}
