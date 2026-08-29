import { join } from "node:path";
import {
  isProfilePlugin,
} from "../constants/profile.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
  removeResourceFromPlugin,
} from "../models/plugin-model.js";
import {
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import { getHarnesstapDir } from "../db/connection.js";
import type { McpServerMetadata } from "../types.js";
import { importApmGitCheckout } from "./apm-git-import.js";
import { resolveAndFetchApmGitDependency } from "./apm-git-resolve.js";
import { readDeclaredLicense } from "./export/license.js";
import type { ApmGitLockFields } from "./lockfile.js";
import { readLockfile } from "./lockfile.js";
import { addDependency } from "./plugin-dependency.js";
import {
  importProjectConfigEnvironments,
  resolveExpectedPluginName,
  resolveProjectProfilePluginName,
} from "./project-config-use.js";
import type { ResolvedProjectConfig } from "./project-config.js";
import { findProjectConfig, getProfileEntry } from "./project-config.js";

export function allocateApmProjectPluginName(preferred: string): string {
  const existing = getPluginByName(preferred);
  if (!existing) {
    return preferred;
  }
  if (isProfilePlugin(existing)) {
    return `${preferred}-project`;
  }
  return preferred;
}

function ensureProjectPlugin(name: string, version: string, description: string) {
  const existing = getPluginByName(name);
  if (existing) {
    for (const resource of getPluginResources(existing.id)) {
      removeResourceFromPlugin(existing.id, resource.id);
    }
    return existing;
  }
  return createPlugin({
    name,
    version,
    description,
  });
}

function attachMcpServers(pluginId: string, config: ResolvedProjectConfig): void {
  const namespace = config.apm_name ?? "apm";
  for (const mcp of config.mcpDependencies) {
    const transport: McpServerMetadata["transport"] =
      mcp.transport ?? (mcp.url ? "http" : "stdio");
    const metadata: McpServerMetadata = {
      transport,
      ...(mcp.command ? { command: mcp.command } : {}),
      ...(mcp.args ? { args: mcp.args } : {}),
      ...(mcp.url ? { url: mcp.url } : {}),
      ...(mcp.env ? { env: mcp.env } : {}),
      ...(mcp.headers ? { headers: mcp.headers } : {}),
    };
    const upserted = upsertResource(
      normalizeResourceInput({
        type: "mcp_server",
        name: mcp.name,
        namespace,
        description: mcp.registryId ?? "",
        content: "",
        metadata,
        source: "apm.yml",
        origin_kind: "manual",
        origin_ref: mcp.registryId ?? `apm.yml#mcp:${mcp.name}`,
      }),
      { policy: "overwrite" },
    );
    const saved = upserted.action === "skipped" ? upserted.existing : upserted.resource;
    addResourceToPlugin(pluginId, saved.id);
  }
}

function attachOverlayPrimitives(pluginId: string, config: ResolvedProjectConfig): void {
  const primitives = config.overlay?.primitives ?? [];
  const namespace = config.apm_name ?? "apm";
  for (const primitive of primitives) {
    const upserted = upsertResource(
      normalizeResourceInput({
        type: primitive.type,
        name: primitive.name,
        namespace,
        description: primitive.description,
        content: primitive.content,
        metadata: primitive.metadata,
        source: primitive.sourceRelative,
        origin_kind: "local_snapshot",
        origin_ref: primitive.sourceRelative,
      }),
      { policy: "overwrite" },
    );
    const saved = upserted.action === "skipped" ? upserted.existing : upserted.resource;
    addResourceToPlugin(pluginId, saved.id);
  }
}

export function materializeApmProjectPlugin(
  config: ResolvedProjectConfig,
  importedGit: Map<string, { name: string; version: string }> = new Map(),
): string {
  const preferred = config.apm_name ?? "apm-project";
  const name = allocateApmProjectPluginName(preferred);
  const plugin = ensureProjectPlugin(
    name,
    config.apm_version ?? "1.0.0",
    config.apm_description ?? `Project plugin materialized from ${config.configPath}`,
  );

  for (const dependency of config.apmDependencies) {
    if (dependency.sourceKind === "git") {
      const imported = importedGit.get(gitDependencyKey(dependency.originRef, dependency.path));
      if (!imported) {
        throw new Error(
          `Git dependency ${dependency.originRef} was not materialized before apply`,
        );
      }
      addDependency(plugin.id, imported.name, {
        versionConstraint: imported.version,
      });
      continue;
    }
    addDependency(plugin.id, dependency.applySelector, {
      ...(dependency.versionConstraint
        ? { versionConstraint: dependency.versionConstraint }
        : {}),
    });
  }

  attachMcpServers(plugin.id, config);
  attachOverlayPrimitives(plugin.id, config);
  return plugin.name;
}

function gitDependencyKey(originRef: string, path?: string): string {
  return path ? `${originRef}#${path}` : originRef;
}

export async function materializeApmGitDependencies(
  config: ResolvedProjectConfig,
  options: { update?: boolean; harnesstapDir?: string } = {},
): Promise<{ imported: Map<string, { name: string; version: string }>; gitLocks: ApmGitLockFields[] }> {
  const imported = new Map<string, { name: string; version: string }>();
  const gitLocks: ApmGitLockFields[] = [];
  const gitDeps = config.apmDependencies.filter((dependency) => dependency.sourceKind === "git");
  if (gitDeps.length === 0) {
    return { imported, gitLocks };
  }

  const lock = options.update ? undefined : readLockfile(config.rootPath);
  const harnesstapDir = options.harnesstapDir ?? getHarnesstapDir();

  for (const dependency of gitDeps) {
    const fetched = resolveAndFetchApmGitDependency(dependency, harnesstapDir, {
      ...(options.update ? { update: true } : {}),
      ...(lock ? { lock } : {}),
    });
    const { plugin, resolution } = await importApmGitCheckout(fetched, fetched.checkoutRoot);
    imported.set(gitDependencyKey(dependency.originRef, dependency.path), {
      name: plugin.name,
      version: plugin.version,
    });
    const licenseRoot = resolution.virtualPath
      ? join(fetched.checkoutRoot, resolution.virtualPath)
      : fetched.checkoutRoot;
    const declared_license = readDeclaredLicense(licenseRoot);
    gitLocks.push({
      name: plugin.name,
      repo_url: resolution.repoUrl,
      resolved_commit: resolution.commit,
      ...(resolution.resolvedRef ? { resolved_ref: resolution.resolvedRef } : {}),
      ...(resolution.constraint ? { constraint: resolution.constraint } : {}),
      ...(resolution.resolvedTag ? { resolved_tag: resolution.resolvedTag } : {}),
      ...(resolution.virtualPath ? { virtual_path: resolution.virtualPath } : {}),
      ...(declared_license ? { declared_license } : {}),
    });
  }

  return { imported, gitLocks };
}

function hasManifestInstallables(config: ResolvedProjectConfig): boolean {
  return (
    config.apmDependencies.length > 0
    || config.mcpDependencies.length > 0
    || (config.overlay?.primitives.length ?? 0) > 0
  );
}

export interface ManifestApplyResolution {
  selectors: string[];
  gitLocks: ApmGitLockFields[];
}

export async function resolveApplySelectorsFromProjectManifest(
  projectRoot: string,
  options: {
    dryRun?: boolean;
    pull?: boolean;
    account?: string;
    baseUrl?: string;
    update?: boolean;
  } = {},
): Promise<ManifestApplyResolution | null> {
  const config = findProjectConfig(projectRoot);
  if (!config) {
    return null;
  }

  if (!options.dryRun) {
    await importProjectConfigEnvironments(config);
  }

  const selectors: string[] = [];
  let gitLocks: ApmGitLockFields[] = [];

  if (hasManifestInstallables(config)) {
    const git = await materializeApmGitDependencies(config, {
      ...(options.update ? { update: true } : {}),
    });
    gitLocks = git.gitLocks;
    selectors.push(materializeApmProjectPlugin(config, git.imported));
  }

  if (config.default_profile) {
    const entry = getProfileEntry(config, config.default_profile);
    if (options.dryRun) {
      selectors.push(resolveExpectedPluginName(config, entry));
    } else {
      const pluginName = await resolveProjectProfilePluginName(config, entry, {
        pull: options.pull ?? true,
        account: options.account,
        baseUrl: options.baseUrl,
      });
      if (!selectors.includes(pluginName)) {
        if (selectors.length > 0) {
          const host = getPluginByName(selectors[0] ?? "");
          if (host) {
            addDependency(host.id, pluginName);
          }
        } else {
          selectors.push(pluginName);
        }
      }
    }
  } else if (config.profiles.length === 1 && selectors.length === 0) {
    const [only] = config.profiles;
    if (only) {
      selectors.push(resolveExpectedPluginName(config, only));
    }
  }

  if (selectors.length === 0) {
    return null;
  }
  return { selectors, gitLocks };
}
