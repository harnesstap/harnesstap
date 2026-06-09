import { join } from "node:path";
import { getSourcesToRefresh, markSourceRefreshed } from "../refresh-cache.js";
import {
  claudePluginsDir,
  loadInstalled,
  parsePluginRef,
  readJsonFile,
  type InstalledPluginsFile,
} from "../claude-installed.js";
import {
  defaultRunCommand,
  type CommandResult,
  type RunCommand,
} from "../run-command.js";
import type {
  PluginCheckOptions,
  PluginCheckResult,
  PluginContext,
  PluginInstall,
  PluginInstallOptions,
  PluginInstallResult,
  PluginProvider,
  PluginScope,
  PluginUpdateOptions,
  PluginUpdateResult,
} from "../types.js";

interface MarketplacePluginEntry {
  name: string;
  version?: string;
  source?: string | { sha?: string; ref?: string; url?: string };
}

interface MarketplaceFile {
  name: string;
  plugins?: MarketplacePluginEntry[];
}

export interface ClaudeCodeProviderDeps {
  runCommand?: RunCommand;
  claudeBinary?: string;
}

function marketplaceSourceKey(marketplace: string): string {
  return `claude:marketplace:${marketplace}`;
}

function resolveLatestFromMarketplace(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): { latestVersion?: string; latestSha?: string } {
  const marketplacePath = join(
    claudePluginsDir(homeRoot),
    "marketplaces",
    marketplace,
    ".claude-plugin",
    "marketplace.json",
  );
  const file = readJsonFile<MarketplaceFile>(marketplacePath);
  const entry = file?.plugins?.find((p) => p.name === pluginName);
  if (!entry) return {};
  if (entry.version) return { latestVersion: entry.version };
  if (typeof entry.source === "object" && entry.source.sha) {
    return { latestVersion: entry.source.sha.slice(0, 12), latestSha: entry.source.sha };
  }
  if (typeof entry.source === "object" && entry.source.ref) {
    return { latestVersion: entry.source.ref };
  }
  return {};
}

export class ClaudeCodePluginProvider implements PluginProvider {
  readonly platformId = "claude-code";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    install: true,
    updateMethod: "native-cli" as const,
    installMethod: "native-cli" as const,
  };

  constructor(private readonly deps: ClaudeCodeProviderDeps = {}) {}

  private runClaude(args: string[], ctx?: PluginContext): CommandResult {
    const run = this.deps.runCommand ?? defaultRunCommand;
    const binary = this.deps.claudeBinary ?? "claude";
    return run(binary, ["plugin", ...args], {
      cwd: ctx?.projectRoot,
    });
  }

  async list(ctx: PluginContext): Promise<PluginInstall[]> {
    return loadInstalled(ctx.homeRoot);
  }

  async check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]> {
    const installs = loadInstalled(ctx.homeRoot);
    const marketplaces = new Set(
      installs.map((i) => parsePluginRef(i.ref).marketplace).filter(Boolean),
    );

    const toRefresh = getSourcesToRefresh(
      [...marketplaces].map(marketplaceSourceKey),
      opts.refreshCache,
      opts.maxAgeHours,
      opts.forceRefresh,
    );

    for (const key of toRefresh) {
      const marketplace = key.replace("claude:marketplace:", "");
      const result = this.runClaude(["marketplace", "update", marketplace], ctx);
      if (result.exitCode === 0) {
        Object.assign(
          opts.refreshCache,
          markSourceRefreshed(opts.refreshCache, key),
        );
      }
    }

    const results: PluginCheckResult[] = [];
    for (const install of installs) {
      if (opts.scopes && !opts.scopes.includes(install.scope)) continue;
      const { name, marketplace } = parsePluginRef(install.ref);
      const latest = resolveLatestFromMarketplace(
        ctx.homeRoot,
        marketplace,
        name,
      );
      let status: PluginCheckResult["status"] = "unknown";
      if (latest.latestSha) {
        const installed = readJsonFile<InstalledPluginsFile>(
          join(claudePluginsDir(ctx.homeRoot), "installed_plugins.json"),
        );
        const sha =
          installed?.plugins[install.ref]?.[0]?.gitCommitSha?.slice(0, 12);
        status =
          sha && latest.latestSha.startsWith(sha) ? "current" : "outdated";
      } else if (latest.latestVersion) {
        status =
          install.version === latest.latestVersion ? "current" : "outdated";
      }
      results.push({
        ...install,
        status,
        latestVersion: latest.latestVersion ?? latest.latestSha,
        latestSource: marketplaceSourceKey(marketplace),
        refreshSkipped: !toRefresh.includes(marketplaceSourceKey(marketplace)),
      });
    }
    return results;
  }

  async update(
    ctx: PluginContext,
    opts: PluginUpdateOptions,
  ): Promise<PluginUpdateResult[]> {
    const targets = opts.ref
      ? loadInstalled(ctx.homeRoot).filter((i) => i.ref === opts.ref)
      : loadInstalled(ctx.homeRoot);

    const results: PluginUpdateResult[] = [];
    for (const install of targets) {
      if (opts.scopes && !opts.scopes.includes(install.scope)) continue;
      if (install.scope === "managed" && !opts.yes) {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "skipped",
          message: "Managed scope updates require --yes",
        });
        continue;
      }
      const args = ["update", install.ref, "--scope", install.scope];
      const result = this.runClaude(args, ctx);
      if (result.exitCode === 0) {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "updated",
          previousVersion: install.version,
          message: result.stdout.trim() || "Updated via claude plugin",
        });
      } else {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "failed",
          previousVersion: install.version,
          message: result.stderr.trim() || result.stdout.trim() || "Update failed",
        });
      }
    }
    return results;
  }

  async install(
    ctx: PluginContext,
    opts: PluginInstallOptions,
  ): Promise<PluginInstallResult> {
    const scope: PluginScope = opts.scope ?? "user";
    const existing = loadInstalled(ctx.homeRoot).find(
      (install) => install.ref === opts.ref && install.scope === scope,
    );
    if (existing) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "already_installed",
        install: existing,
        message: `Already installed (${scope})`,
      };
    }

    const args = ["install", opts.ref, "--scope", scope];
    const result = this.runClaude(args, ctx);
    if (result.exitCode !== 0) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message: result.stderr.trim() || result.stdout.trim() || "claude plugin install failed",
      };
    }

    const install = loadInstalled(ctx.homeRoot).find(
      (row) => row.ref === opts.ref && row.scope === scope,
    );
    if (!install) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message: "Install command succeeded but plugin was not registered in installed_plugins.json",
      };
    }

    return {
      ref: opts.ref,
      platformId: this.platformId,
      scope,
      status: "installed",
      install,
      message: result.stdout.trim() || "Installed via claude plugin",
    };
  }
}
