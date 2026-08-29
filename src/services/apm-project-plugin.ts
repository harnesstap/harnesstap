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
import { isFilesystemApmDependency } from "./apm-dependencies.js";
import {
  gitDependencyKey,
  materializeApmDependencyGraph,
} from "./apm-graph.js";
import type { ApmGitLockFields } from "./lockfile.js";
import { resolveMcpDependencies } from "./mcp-registry-resolve.js";
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

async function attachMcpServers(pluginId: string, config: ResolvedProjectConfig): Promise<void> {
  const namespace = config.apm_name ?? "apm";
  const resolved = await resolveMcpDependencies(config.mcpDependencies);
  for (const mcp of resolved) {
    const upserted = upsertResource(
      normalizeResourceInput({
        type: "mcp_server",
        name: mcp.name,
        namespace,
        description: mcp.registryId ?? "",
        content: "",
        metadata: mcp.metadata,
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

export async function materializeApmProjectPlugin(
  config: ResolvedProjectConfig,
  importedGit: Map<string, { name: string; version: string }> = new Map(),
): Promise<string> {
  const preferred = config.apm_name ?? "apm-project";
  const name = allocateApmProjectPluginName(preferred);
  const plugin = ensureProjectPlugin(
    name,
    config.apm_version ?? "1.0.0",
    config.apm_description ?? `Project plugin materialized from ${config.configPath}`,
  );

  for (const dependency of config.apmDependencies) {
    if (dependency.sourceKind === "git" || isFilesystemApmDependency(dependency)) {
      const imported = importedGit.get(gitDependencyKey(dependency.originRef, dependency.path))
        ?? importedGit.get(gitDependencyKey(dependency.originRef));
      if (!imported) {
        throw new Error(
          `APM dependency ${dependency.originRef} was not materialized before apply`,
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

  await attachMcpServers(plugin.id, config);
  attachOverlayPrimitives(plugin.id, config);
  return plugin.name;
}

export async function materializeApmGitDependencies(
  config: ResolvedProjectConfig,
  options: { update?: boolean; harnesstapDir?: string } = {},
): Promise<{ imported: Map<string, { name: string; version: string }>; gitLocks: ApmGitLockFields[] }> {
  return materializeApmDependencyGraph(config, options);
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
    selectors.push(await materializeApmProjectPlugin(config, git.imported));
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
