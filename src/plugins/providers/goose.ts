import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

interface GoosePluginManifest {
  name: string;
  version?: string;
  description?: string;
  repository?: string;
}

export interface GooseProviderDeps {
  runCommand?: RunCommand;
  gooseBinary?: string;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readPluginManifest(installPath: string): GoosePluginManifest | null {
  const candidates = [
    join(installPath, "plugin.json"),
    join(installPath, ".goose-plugin", "plugin.json"),
    join(installPath, ".plugin", "plugin.json"),
  ];
  for (const manifestPath of candidates) {
    const manifest = readJson<GoosePluginManifest>(manifestPath);
    if (manifest?.name) return manifest;
  }
  return null;
}

export function goosePluginsDir(homeRoot: string): string {
  return join(homeRoot, ".agents", "plugins");
}

function scanGoosePlugins(homeRoot: string): PluginInstall[] {
  const pluginsRoot = goosePluginsDir(homeRoot);
  if (!isDirectory(pluginsRoot)) return [];

  const installs: PluginInstall[] = [];
  for (const entry of readdirSync(pluginsRoot)) {
    if (entry.startsWith(".")) continue;
    const installPath = join(pluginsRoot, entry);
    if (!isDirectory(installPath)) continue;

    const manifest = readPluginManifest(installPath);
    const name = manifest?.name ?? entry;
    installs.push({
      ref: name,
      platformId: "goose",
      name,
      version: manifest?.version ?? "0.0.0",
      versionSource: manifest?.version ? "manifest" : "unknown",
      scope: "user",
      enabled: true,
      installPath,
      metadata: {
        description: manifest?.description,
        repository: manifest?.repository,
      },
    });
  }
  return installs;
}

export class GoosePluginProvider implements PluginProvider {
  readonly platformId = "goose";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    install: true,
    updateMethod: "native-cli" as const,
    installMethod: "native-cli" as const,
  };

  constructor(private readonly deps: GooseProviderDeps = {}) {}

  private runGoose(args: string[], ctx?: PluginContext): CommandResult {
    const run = this.deps.runCommand ?? defaultRunCommand;
    const binary = this.deps.gooseBinary ?? "goose";
    return run(binary, args, { cwd: ctx?.projectRoot });
  }

  async list(ctx: PluginContext): Promise<PluginInstall[]> {
    return scanGoosePlugins(ctx.homeRoot);
  }

  async check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]> {
    const installs = scanGoosePlugins(ctx.homeRoot);
    return installs
      .filter((install) => !opts.scopes || opts.scopes.includes(install.scope))
      .map((install) => ({
        ...install,
        status: "unknown" as const,
        message: "Use goose plugin update to refresh git-backed plugins",
        refreshSkipped: true,
      }));
  }

  async update(
    ctx: PluginContext,
    opts: PluginUpdateOptions,
  ): Promise<PluginUpdateResult[]> {
    const installs = scanGoosePlugins(ctx.homeRoot);
    const targets = opts.ref
      ? installs.filter((install) => install.ref === opts.ref)
      : installs;
    const results: PluginUpdateResult[] = [];

    for (const install of targets) {
      const result = this.runGoose(["plugin", "update", install.name], ctx);
      if (result.exitCode === 0) {
        const refreshed = scanGoosePlugins(ctx.homeRoot).find(
          (row) => row.name === install.name,
        );
        results.push({
          ref: install.ref,
          platformId: this.platformId,
          scope: install.scope,
          status: "updated",
          previousVersion: install.version,
          newVersion: refreshed?.version,
          message: result.stdout.trim() || "Updated via goose plugin update",
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
    const existing = scanGoosePlugins(ctx.homeRoot).find(
      (install) => install.ref === opts.ref || install.name === opts.ref,
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

    const result = this.runGoose(["plugin", "install", opts.ref], ctx);
    if (result.exitCode !== 0) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message: result.stderr.trim() || result.stdout.trim() || "goose plugin install failed",
      };
    }

    const install = scanGoosePlugins(ctx.homeRoot).find(
      (row) => row.ref === opts.ref || row.name === opts.ref,
    );
    if (!install) {
      const byName = scanGoosePlugins(ctx.homeRoot).at(-1);
      if (byName) {
        return {
          ref: opts.ref,
          platformId: this.platformId,
          scope,
          status: "installed",
          install: byName,
          message: result.stdout.trim() || "Installed via goose plugin install",
        };
      }
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message:
          "Install command succeeded but plugin was not found under ~/.agents/plugins/",
      };
    }

    return {
      ref: opts.ref,
      platformId: this.platformId,
      scope,
      status: "installed",
      install,
      message: result.stdout.trim() || "Installed via goose plugin install",
    };
  }
}
