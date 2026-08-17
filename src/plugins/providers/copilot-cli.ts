import { parsePluginRef } from "../claude-installed.js";
import {
  loadInstalledCopilotPlugins,
} from "../copilot-installed.js";
import { defaultRunCommand, type CommandResult, type RunCommand } from "../run-command.js";
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

export interface CopilotProviderDeps {
  runCommand?: RunCommand;
  copilotBinary?: string;
}

function findInstall(
  installs: PluginInstall[],
  ref: string,
): PluginInstall | undefined {
  return installs.find(
    (install) => install.ref === ref || install.name === ref,
  );
}

export class CopilotPluginProvider implements PluginProvider {
  readonly platformId = "copilot-cli";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    install: true,
    updateMethod: "native-cli" as const,
    installMethod: "native-cli" as const,
  };

  constructor(private readonly deps: CopilotProviderDeps = {}) {}

  private runCopilot(args: string[], ctx?: PluginContext): CommandResult {
    const run = this.deps.runCommand ?? defaultRunCommand;
    const binary = this.deps.copilotBinary ?? "copilot";
    return run(binary, ["plugin", ...args], {
      cwd: ctx?.projectRoot,
    });
  }

  async list(ctx: PluginContext): Promise<PluginInstall[]> {
    return loadInstalledCopilotPlugins(ctx.homeRoot);
  }

  async check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]> {
    const installs = loadInstalledCopilotPlugins(ctx.homeRoot);
    return installs
      .filter((install) => !opts.scopes || opts.scopes.includes(install.scope))
      .map((install) => ({
        ...install,
        status: "unknown" as const,
        message: "Use copilot plugin update to refresh Copilot CLI plugins",
        refreshSkipped: true,
      }));
  }

  async update(
    ctx: PluginContext,
    opts: PluginUpdateOptions,
  ): Promise<PluginUpdateResult[]> {
    const installs = loadInstalledCopilotPlugins(ctx.homeRoot);
    const targets = opts.ref
      ? installs.filter(
          (install) => install.ref === opts.ref || install.name === opts.ref,
        )
      : installs;
    const results: PluginUpdateResult[] = [];

    for (const install of targets) {
      if (opts.scopes && !opts.scopes.includes(install.scope)) continue;
      const result = this.runCopilot(["update", install.ref], ctx);
      if (result.exitCode === 0) {
        const refreshed = findInstall(
          loadInstalledCopilotPlugins(ctx.homeRoot),
          install.ref,
        );
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "updated",
          previousVersion: install.version,
          newVersion: refreshed?.version,
          message: result.stdout.trim() || "Updated via copilot plugin update",
        });
      } else {
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "failed",
          previousVersion: install.version,
          message:
            result.stderr.trim() || result.stdout.trim() || "Update failed",
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
    const existing = findInstall(
      loadInstalledCopilotPlugins(ctx.homeRoot),
      opts.ref,
    );
    if (existing) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "already_installed",
        install: existing,
        message: `Already installed (${existing.scope})`,
      };
    }

    const { marketplace } = parsePluginRef(opts.ref);
    if (marketplace) {
      this.runCopilot(["marketplace", "update", marketplace], ctx);
    }

    const result = this.runCopilot(["install", opts.ref], ctx);
    if (result.exitCode !== 0) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message:
          result.stderr.trim()
          || result.stdout.trim()
          || "copilot plugin install failed",
      };
    }

    const install = findInstall(
      loadInstalledCopilotPlugins(ctx.homeRoot),
      opts.ref,
    );
    if (!install) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message:
          "Install command succeeded but plugin was not found under ~/.copilot/installed-plugins/",
      };
    }

    return {
      ref: opts.ref,
      platformId: this.platformId,
      scope,
      status: "installed",
      install,
      message: result.stdout.trim() || "Installed via copilot plugin install",
    };
  }
}
