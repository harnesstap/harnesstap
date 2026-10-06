import { join } from "node:path";
import {
  collectCursorEnablementSignals,
  type CollectCursorEnablementSignals,
} from "../cursor-enablement.js";
import { listCursorPluginInstalls } from "../cursor-inventory.js";
import {
  getSourcesToRefresh,
  markSourceRefreshed,
} from "../refresh-cache.js";
import {
  cursorRepoSourceKey,
  refreshGitSource,
} from "../refresh.js";
import { defaultRunCommand, type RunCommand } from "../run-command.js";
import { installCursorLocalPlugin } from "../cursor-local-install.js";
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

export {
  listCursorPluginFootprintNames,
  listCursorPluginInstalls,
} from "../cursor-inventory.js";

export interface CursorProviderDeps {
  runCommand?: RunCommand;
  collectEnablementSignals?: CollectCursorEnablementSignals;
}

export class CursorPluginProvider implements PluginProvider {
  readonly platformId = "cursor";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    install: true,
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
    ctx: PluginContext,
    opts: PluginInstallOptions,
  ): Promise<PluginInstallResult> {
    return installCursorLocalPlugin(ctx, opts);
  }
}
