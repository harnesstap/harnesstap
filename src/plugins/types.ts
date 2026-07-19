export type PluginScope = "user" | "project" | "local" | "managed";

export type PluginUpdateMethod = "native-cli" | "git" | "unsupported";

export type PluginVersionSource = "manifest" | "marketplace" | "git_sha" | "unknown";

export interface PluginInstall {
  ref: string;
  platformId: string;
  name: string;
  version: string;
  versionSource: PluginVersionSource;
  scope: PluginScope;
  enabled: boolean;
  installPath?: string;
  metadata?: {
    description?: string;
    repository?: string;
    homepage?: string;
  };
}

export interface PluginCheckResult extends PluginInstall {
  status: "current" | "outdated" | "unknown";
  latestVersion?: string;
  latestSource?: string;
  refreshSkipped?: boolean;
  message?: string;
}

export interface PluginUpdateResult {
  ref: string;
  platformId: string;
  scope: PluginScope;
  status: "updated" | "skipped" | "failed" | "unsupported";
  previousVersion?: string;
  newVersion?: string;
  message: string;
}

export interface PluginContext {
  projectRoot: string;
  homeRoot: string;
  harnesstapDir: string;
}

export interface PluginCheckOptions {
  forceRefresh: boolean;
  maxAgeHours: number;
  refreshCache: import("./refresh-cache.js").RefreshCacheFile;
  scopes?: PluginScope[];
}

export interface PluginUpdateOptions {
  ref?: string;
  scopes?: PluginScope[];
  yes: boolean;
}

export interface PluginInstallOptions {
  ref: string;
  scope?: PluginScope;
  version?: string;
}

export interface PluginInstallResult {
  ref: string;
  platformId: string;
  scope: PluginScope;
  status: "installed" | "already_installed" | "failed" | "unsupported";
  install?: PluginInstall;
  message: string;
}

export interface PluginProviderCapabilities {
  inventory: boolean;
  check: boolean;
  update: boolean;
  install: boolean;
  updateMethod: PluginUpdateMethod;
  installMethod: PluginUpdateMethod;
}

export interface PluginProvider {
  readonly platformId: string;
  readonly capabilities: PluginProviderCapabilities;
  list(ctx: PluginContext): Promise<PluginInstall[]>;
  check(
    ctx: PluginContext,
    opts: PluginCheckOptions,
  ): Promise<PluginCheckResult[]>;
  update(
    ctx: PluginContext,
    opts: PluginUpdateOptions,
  ): Promise<PluginUpdateResult[]>;
  install(
    ctx: PluginContext,
    opts: PluginInstallOptions,
  ): Promise<PluginInstallResult>;
}
