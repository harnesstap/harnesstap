import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveDshHome } from "../../platforms/deepseek-harness-home.js";
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
import type { ResourceCreateInput } from "../../types.js";

const DSH_MISSING_MESSAGE = "Install DeepSeek Harness (dsh) to manage plugins.";
const REFRESH_MESSAGE =
  "Use dsh plugin --profile web update to refresh DeepSeek Harness plugins";

interface DshPackageJson {
  name?: string;
  version?: string;
  description?: string;
  dsh?: {
    bundle?: {
      patch?: unknown;
    };
  };
}

export interface DeepSeekHarnessProviderDeps {
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

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function webProfileDir(homeRoot: string): string {
  return join(resolveDshHome(homeRoot), "profiles", "web");
}

function packageDirs(nodeModules: string): string[] {
  const dirs: string[] = [];
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith(".")) continue;
    const entryPath = join(nodeModules, entry);
    if (!isDirectory(entryPath)) continue;
    if (entry.startsWith("@")) {
      for (const nested of readdirSync(entryPath)) {
        if (nested.startsWith(".")) continue;
        const nestedPath = join(entryPath, nested);
        if (isDirectory(nestedPath)) dirs.push(nestedPath);
      }
      continue;
    }
    dirs.push(entryPath);
  }
  return dirs;
}

function scanDshBundlePlugins(homeRoot: string): PluginInstall[] {
  const nodeModules = join(webProfileDir(homeRoot), "node_modules");
  if (!isDirectory(nodeModules)) return [];

  const installs: PluginInstall[] = [];
  for (const installPath of packageDirs(nodeModules)) {
    const pkg = readJson<DshPackageJson>(join(installPath, "package.json"));
    if (!pkg || typeof pkg.dsh?.bundle?.patch !== "string") continue;
    if (typeof pkg.name !== "string" || pkg.name.length === 0) continue;

    const name = pkg.name;
    const version = pkg.version;
    installs.push({
      ref: name,
      platformId: "deepseek-harness",
      name,
      version: version ?? "0.0.0",
      versionSource: version ? "manifest" : "unknown",
      scope: "user",
      enabled: true,
      installPath,
      metadata: {
        description: pkg.description,
      },
    });
  }
  return installs;
}

export function listDshBundlePluginPinInputs(homeRoot: string): ResourceCreateInput[] {
  return scanDshBundlePlugins(homeRoot).map((install) => ({
    type: "plugin",
    name: install.name,
    description: install.metadata?.description ?? "",
    content: "{}",
    metadata: {
      source_kind: "local",
      sync_status: "never_synced",
      portable: "reference",
    },
    source: "~/.dsh/profiles/web/",
    origin_kind: "manual",
    origin_ref: install.name,
  }));
}

export class DeepSeekHarnessPluginProvider implements PluginProvider {
  readonly platformId = "deepseek-harness";
  readonly capabilities = {
    inventory: true,
    check: true,
    update: true,
    install: true,
    updateMethod: "native-cli" as const,
    installMethod: "native-cli" as const,
  };

  constructor(private readonly deps: DeepSeekHarnessProviderDeps = {}) {}

  private run(args: string[], ctx?: PluginContext): CommandResult {
    const run = this.deps.runCommand ?? defaultRunCommand;
    return run("dsh", args, { cwd: ctx?.projectRoot });
  }

  async list(ctx: PluginContext): Promise<PluginInstall[]> {
    return scanDshBundlePlugins(ctx.homeRoot);
  }

  async check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]> {
    const installs = scanDshBundlePlugins(ctx.homeRoot);
    return installs
      .filter((install) => !opts.scopes || opts.scopes.includes(install.scope))
      .map((install) => ({
        ...install,
        status: "unknown" as const,
        message: REFRESH_MESSAGE,
        refreshSkipped: true,
      }));
  }

  async update(
    ctx: PluginContext,
    opts: PluginUpdateOptions,
  ): Promise<PluginUpdateResult[]> {
    const installs = scanDshBundlePlugins(ctx.homeRoot);
    const targets = opts.ref
      ? installs.filter((install) => install.ref === opts.ref)
      : installs;
    return targets.map((install) => ({
      ref: install.ref,
      platformId: this.platformId,
      scope: install.scope,
      status: "unsupported" as const,
      previousVersion: install.version,
      message: REFRESH_MESSAGE,
    }));
  }

  async install(
    ctx: PluginContext,
    opts: PluginInstallOptions,
  ): Promise<PluginInstallResult> {
    const scope: PluginScope = opts.scope ?? "user";
    const result = this.run(
      ["plugin", "--profile", "web", "add", opts.ref],
      ctx,
    );
    if (result.exitCode === 0) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "installed",
        message: result.stdout.trim() || "Installed via dsh plugin --profile web add",
      };
    }
    if (result.exitCode === 127 || /not found/i.test(result.stderr)) {
      return {
        ref: opts.ref,
        platformId: this.platformId,
        scope,
        status: "failed",
        message: DSH_MISSING_MESSAGE,
      };
    }
    return {
      ref: opts.ref,
      platformId: this.platformId,
      scope,
      status: "failed",
      message: result.stderr.trim() || result.stdout.trim() || "dsh plugin add failed",
    };
  }
}
