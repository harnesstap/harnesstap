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
import type { McpServerMetadata } from "../types.js";
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

function attachOverlaySkills(pluginId: string, config: ResolvedProjectConfig): void {
  const skills = config.overlay?.skills ?? [];
  const namespace = config.apm_name ?? "apm";
  for (const skill of skills) {
    const upserted = upsertResource(
      normalizeResourceInput({
        type: "skill",
        name: skill.name,
        namespace,
        description: skill.description,
        content: skill.content,
        metadata: {},
        source: skill.skillMdRelative,
        origin_kind: "local_snapshot",
        origin_ref: skill.skillMdRelative,
      }),
      { policy: "overwrite" },
    );
    const saved = upserted.action === "skipped" ? upserted.existing : upserted.resource;
    addResourceToPlugin(pluginId, saved.id);
  }
}

export function materializeApmProjectPlugin(config: ResolvedProjectConfig): string {
  const preferred = config.apm_name ?? "apm-project";
  const name = allocateApmProjectPluginName(preferred);
  const plugin = ensureProjectPlugin(
    name,
    config.apm_version ?? "1.0.0",
    config.apm_description ?? `Project plugin materialized from ${config.configPath}`,
  );

  for (const dependency of config.apmDependencies) {
    const ref =
      dependency.sourceKind === "git" ? dependency.originRef : dependency.applySelector;
    addDependency(plugin.id, ref, {
      ...(dependency.versionConstraint
        ? { versionConstraint: dependency.versionConstraint }
        : {}),
    });
  }

  attachMcpServers(plugin.id, config);
  attachOverlaySkills(plugin.id, config);
  return plugin.name;
}

function hasManifestInstallables(config: ResolvedProjectConfig): boolean {
  return (
    config.apmDependencies.length > 0
    || config.mcpDependencies.length > 0
    || (config.overlay?.skills.length ?? 0) > 0
  );
}

export async function resolveApplySelectorsFromProjectManifest(
  projectRoot: string,
  options: {
    dryRun?: boolean;
    pull?: boolean;
    account?: string;
    baseUrl?: string;
  } = {},
): Promise<string[] | null> {
  const config = findProjectConfig(projectRoot);
  if (!config) {
    return null;
  }

  if (!options.dryRun) {
    await importProjectConfigEnvironments(config);
  }

  const selectors: string[] = [];

  if (hasManifestInstallables(config)) {
    selectors.push(materializeApmProjectPlugin(config));
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
  return selectors;
}
