import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectCursorEnablementSignals,
  type CollectCursorEnablementSignals,
  type CursorEnablementSignals,
} from "../cursor-enablement.js";
import {
  getSourcesToRefresh,
  markSourceRefreshed,
} from "../refresh-cache.js";
import {
  cursorCacheRoot,
  cursorLocalRoot,
  cursorMarketplacesRoot,
  cursorRepoSourceKey,
  refreshGitSource,
} from "../refresh.js";
import { defaultRunCommand, type RunCommand } from "../run-command.js";
import type {
  PluginCheckOptions,
  PluginCheckResult,
  PluginContext,
  PluginInstall,
  PluginInstallOptions,
  PluginInstallResult,
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
  $schema?: string;
}

export interface CursorProviderDeps {
  runCommand?: RunCommand;
  collectEnablementSignals?: CollectCursorEnablementSignals;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isAgentPluginManifest(
  manifest: CursorPluginManifest,
  installPath: string,
): boolean {
  if (
    typeof manifest.$schema === "string" &&
    manifest.$schema.includes("agent-plugins")
  ) {
    return true;
  }
  return (
    existsSync(join(installPath, "skills")) ||
    existsSync(join(installPath, "mcp.json"))
  );
}

function readInstallManifest(
  installPath: string,
): CursorPluginManifest | null {
  const cursorManifest = readJson<CursorPluginManifest>(
    join(installPath, ".cursor-plugin", "plugin.json"),
  );
  if (cursorManifest?.name) return cursorManifest;

  const rootManifest = readJson<CursorPluginManifest>(
    join(installPath, "plugin.json"),
  );
  if (
    rootManifest?.name &&
    isAgentPluginManifest(rootManifest, installPath)
  ) {
    return rootManifest;
  }
  return null;
}

function toInstall(input: {
  manifest: CursorPluginManifest;
  marketplace: string;
  installPath: string;
  versionDirName?: string;
  scope: PluginInstall["scope"];
  enabled: boolean;
}): PluginInstall {
  const version =
    input.manifest.version ?? input.versionDirName ?? "unknown";
  return {
    ref: `${input.manifest.name}@${input.marketplace}`,
    platformId: "cursor",
    name: input.manifest.name,
    version,
    versionSource: input.manifest.version ? "manifest" : "git_sha",
    scope: input.scope,
    enabled: input.enabled,
    installPath: input.installPath,
    metadata: {
      description: input.manifest.description,
      repository: input.manifest.repository,
      homepage: input.manifest.homepage,
    },
  };
}

function isEnabledForCachePlugin(
  name: string,
  signals: CursorEnablementSignals,
): boolean {
  return signals.pluginNames.has(name);
}

function scanCacheInstalls(
  homeRoot: string,
  signals: CursorEnablementSignals,
): PluginInstall[] {
  const cacheRoot = cursorCacheRoot(homeRoot);
  if (!existsSync(cacheRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const marketplace of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const marketplaceDir = join(cacheRoot, marketplace.name);
    for (const pluginDir of readdirSync(marketplaceDir, {
      withFileTypes: true,
    })) {
      if (!pluginDir.isDirectory()) continue;
      const pluginPath = join(marketplaceDir, pluginDir.name);
      for (const versionDir of readdirSync(pluginPath, {
        withFileTypes: true,
      })) {
        if (!versionDir.isDirectory()) continue;
        const installPath = join(pluginPath, versionDir.name);
        const manifest = readInstallManifest(installPath);
        if (!manifest?.name) continue;
        installs.push(
          toInstall({
            manifest,
            marketplace: marketplace.name,
            installPath,
            versionDirName: versionDir.name,
            scope: "user",
            enabled: isEnabledForCachePlugin(manifest.name, signals),
          }),
        );
      }
    }
  }
  return installs;
}

function scanLocalInstalls(homeRoot: string): PluginInstall[] {
  const localRoot = cursorLocalRoot(homeRoot);
  if (!existsSync(localRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const entry of readdirSync(localRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const installPath = join(localRoot, entry.name);
    const manifest = readInstallManifest(installPath);
    if (!manifest?.name) continue;
    installs.push(
      toInstall({
        manifest,
        marketplace: "local",
        installPath,
        scope: "local",
        enabled: true,
      }),
    );
  }
  return installs;
}

/**
 * Scan github.com/<owner>/<repo>/<sha> marketplace checkouts that are not
 * already represented in the cache inventory.
 */
function scanMarketplaceInstalls(
  homeRoot: string,
  existingRefs: ReadonlySet<string>,
  signals: CursorEnablementSignals,
): PluginInstall[] {
  const marketplacesRoot = cursorMarketplacesRoot(homeRoot);
  const hostRoot = join(marketplacesRoot, "github.com");
  if (!existsSync(hostRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const owner of readdirSync(hostRoot, { withFileTypes: true })) {
    if (!owner.isDirectory() || owner.name.startsWith("_")) continue;
    const ownerDir = join(hostRoot, owner.name);
    for (const repo of readdirSync(ownerDir, { withFileTypes: true })) {
      if (!repo.isDirectory()) continue;
      const repoDir = join(ownerDir, repo.name);
      for (const versionDir of readdirSync(repoDir, { withFileTypes: true })) {
        if (!versionDir.isDirectory()) continue;
        const installPath = join(repoDir, versionDir.name);
        const manifest = readInstallManifest(installPath);
        if (!manifest?.name) continue;
        const ref = `${manifest.name}@${owner.name}`;
        if (existingRefs.has(ref)) continue;
        // Also skip when the same plugin name already exists in cache under any marketplace.
        const alreadyCached = [...existingRefs].some((existing) =>
          existing.startsWith(`${manifest.name}@`),
        );
        if (alreadyCached) continue;
        installs.push(
          toInstall({
            manifest,
            marketplace: owner.name,
            installPath,
            versionDirName: versionDir.name,
            scope: "user",
            enabled: isEnabledForCachePlugin(manifest.name, signals),
          }),
        );
      }
    }
  }
  return installs;
}

/** Synchronous Cursor inventory used by status panels and the provider. */
export function listCursorPluginInstalls(
  homeRoot: string,
  collectSignals: CollectCursorEnablementSignals = collectCursorEnablementSignals,
): PluginInstall[] {
  const signals = collectSignals(homeRoot);
  const cache = scanCacheInstalls(homeRoot, signals);
  const local = scanLocalInstalls(homeRoot);
  const refs = new Set(cache.map((row) => row.ref));
  const marketplaces = scanMarketplaceInstalls(homeRoot, refs, signals);
  return [...cache, ...local, ...marketplaces];
}

export class CursorPluginProvider implements PluginProvider {
  readonly platformId = "cursor";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    install: false,
    updateMethod: "git" as const,
    installMethod: "unsupported" as const,
  };

  constructor(private readonly deps: CursorProviderDeps = {}) {}

  private collectSignals(): CollectCursorEnablementSignals {
    return this.deps.collectEnablementSignals ?? collectCursorEnablementSignals;
  }

  async list(ctx: PluginContext): Promise<PluginInstall[]> {
    return listCursorPluginInstalls(ctx.homeRoot, this.collectSignals());
  }

  async check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]> {
    const installs = listCursorPluginInstalls(
      ctx.homeRoot,
      this.collectSignals(),
    );
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
        const tmpParent = join(ctx.harnesstapDir, "tmp-refresh");
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
    const installs = listCursorPluginInstalls(
      ctx.homeRoot,
      this.collectSignals(),
    );
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

  async install(
    _ctx: PluginContext,
    opts: PluginInstallOptions,
  ): Promise<PluginInstallResult> {
    return {
      ref: opts.ref,
      platformId: this.platformId,
      scope: opts.scope ?? "user",
      status: "unsupported",
      message:
        "Cursor has no `agent plugin install` command. Register the marketplace with `agent plugin marketplace add`, then install from Cursor Customize or /plugin.",
    };
  }
}
