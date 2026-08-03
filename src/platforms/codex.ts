import { join } from "node:path";
import { parse } from "smol-toml";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { formatTransportToml } from "../services/transport/write.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import {
  canonicalAgentFromResource,
  emitCodexAgentToml,
} from "../services/agent-bridge.js";
import type {
  AgentMetadata,
  EnvVarMetadata,
  HookMetadata,
  McpServerMetadata,
  ModelConfigMetadata,
  PermissionMetadata,
  PlatformDefinition,
  ResourceCreateInput,
  Resource,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

interface CodexMcpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

interface CodexPermissionProfile {
  filesystem?: Record<string, unknown>;
  network?: {
    domains?: Record<string, string>;
  };
}

type CodexConfigDocument = Record<string, unknown>;

const FILESYSTEM_PERMISSION_PREFIX = "filesystem:";
const NETWORK_PERMISSION_PREFIX = "network:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCodexConfig(content: string): CodexConfigDocument | undefined {
  try {
    const parsed = parse(content);
    if (!isRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function collectFilesystemRules(
  filesystem: Record<string, unknown>,
  profile: string,
  scopePrefix = "",
): Array<{ profile: string; path: string; mode: string }> {
  const rules: Array<{ profile: string; path: string; mode: string }> = [];

  for (const [key, value] of Object.entries(filesystem)) {
    if (key === "glob_scan_max_depth") continue;
    if (typeof value === "string") {
      const path = scopePrefix ? `${scopePrefix}:${key}` : key;
      rules.push({ profile, path, mode: value });
      continue;
    }
    if (isRecord(value)) {
      rules.push(...collectFilesystemRules(value, profile, key));
    }
  }

  return rules;
}

function permissionActionFromMode(mode: string): PermissionMetadata["action"] {
  return mode === "deny" ? "deny" : "allow";
}

function permissionName(
  action: PermissionMetadata["action"],
  profile: string,
  target: string,
): string {
  const slug = target.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${action}-${profile}-${slug}`;
}

function encodePermissionPattern(
  prefix: string,
  profile: string,
  mode: string,
  target: string,
): string {
  return `${prefix}${profile}:${mode}:${target}`;
}

function decodePermissionPattern(
  pattern: string,
  prefix: string,
): { profile: string; mode: string; target: string } | undefined {
  if (!pattern.startsWith(prefix)) return undefined;
  const body = pattern.slice(prefix.length);
  const first = body.indexOf(":");
  const second = body.indexOf(":", first + 1);
  if (first === -1 || second === -1) return undefined;
  return {
    profile: body.slice(0, first),
    mode: body.slice(first + 1, second),
    target: body.slice(second + 1),
  };
}

function setNestedFilesystemRule(
  target: Record<string, unknown>,
  path: string,
  mode: string,
): void {
  const segments = path.split(":");
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] ?? "";
    const next = current[segment];
    if (!isRecord(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1] ?? path;
  current[leaf] = mode;
}

function buildPermissionProfiles(
  permissions: Resource[],
): Record<string, CodexPermissionProfile> {
  const profiles: Record<string, CodexPermissionProfile> = {};

  for (const resource of permissions) {
    const metadata = resource.metadata as PermissionMetadata;
    const filesystemRule = decodePermissionPattern(
      metadata.pattern,
      FILESYSTEM_PERMISSION_PREFIX,
    );
    if (filesystemRule) {
      const profileConfig = profiles[filesystemRule.profile] ?? {};
      if (!profileConfig.filesystem) {
        profileConfig.filesystem = {};
      }
      const filesystem = profileConfig.filesystem;
      setNestedFilesystemRule(
        filesystem,
        filesystemRule.target,
        filesystemRule.mode,
      );
      profiles[filesystemRule.profile] = profileConfig;
      continue;
    }

    const networkRule = decodePermissionPattern(
      metadata.pattern,
      NETWORK_PERMISSION_PREFIX,
    );
    if (networkRule) {
      const profileConfig = profiles[networkRule.profile] ?? {};
      if (!profileConfig.network) {
        profileConfig.network = {};
      }
      const network = profileConfig.network;
      if (!network.domains) {
        network.domains = {};
      }
      const domains = network.domains;
      domains[networkRule.target] = networkRule.mode;
      profiles[networkRule.profile] = profileConfig;
    }
  }

  return profiles;
}

function buildMcpServers(
  mcps: Resource[],
): Record<string, Record<string, unknown>> {
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const resource of mcps) {
    const metadata = resource.metadata as McpServerMetadata;
    const entry: Record<string, unknown> = {};
    if (metadata.transport === "http" || metadata.url) {
      if (metadata.url) entry.url = metadata.url;
    } else {
      if (metadata.command) entry.command = metadata.command;
      if (metadata.args && metadata.args.length > 0) entry.args = metadata.args;
      if (metadata.env && Object.keys(metadata.env).length > 0) {
        entry.env = metadata.env;
      }
    }
    mcpServers[resource.name] = entry;
  }

  return mcpServers;
}

function mergeConfigDocuments(
  existing: CodexConfigDocument,
  overlay: CodexConfigDocument,
): CodexConfigDocument {
  const merged: CodexConfigDocument = { ...existing };

  for (const [key, value] of Object.entries(overlay)) {
    if (key === "permissions" && isRecord(value) && isRecord(merged.permissions)) {
      merged.permissions = { ...merged.permissions, ...value };
      continue;
    }
    if (
      key === "shell_environment_policy" &&
      isRecord(value) &&
      isRecord(merged.shell_environment_policy)
    ) {
      const existingPolicy = merged.shell_environment_policy;
      const overlayPolicy = value;
      const existingSet = isRecord(existingPolicy.set) ? existingPolicy.set : {};
      const overlaySet = isRecord(overlayPolicy.set) ? overlayPolicy.set : {};
      merged.shell_environment_policy = {
        ...existingPolicy,
        ...overlayPolicy,
        set: { ...existingSet, ...overlaySet },
      };
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

export class CodexSerializer extends BaseSerializer {
  readonly platformId = "codex";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const p = getPlatform("codex");
    if (!p) throw new Error("codex platform not found in registry");
    this.platform = p;
  }

  private scanConfigResources(
    config: CodexConfigDocument,
    source: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];

    const mcpServers = config.mcp_servers;
    if (isRecord(mcpServers)) {
      for (const [name, entryValue] of Object.entries(mcpServers)) {
        if (!isRecord(entryValue)) continue;
        const entry = entryValue as CodexMcpServerEntry;
        const metadata: McpServerMetadata = {
          transport: entry.url ? "http" : "stdio",
          command: entry.command,
          args: entry.args,
          url: entry.url,
          env: entry.env,
        };
        resources.push(
          this.makeResource("mcp_server", name, "", source, metadata),
        );
      }
    }

    const permissions = config.permissions;
    if (isRecord(permissions)) {
      for (const [profile, profileValue] of Object.entries(permissions)) {
        if (!isRecord(profileValue)) continue;
        const profileConfig = profileValue as CodexPermissionProfile;

        if (isRecord(profileConfig.filesystem)) {
          for (const rule of collectFilesystemRules(
            profileConfig.filesystem,
            profile,
          )) {
            const action = permissionActionFromMode(rule.mode);
            const pattern = encodePermissionPattern(
              FILESYSTEM_PERMISSION_PREFIX,
              rule.profile,
              rule.mode,
              rule.path,
            );
            resources.push(
              this.makeResource(
                "permission",
                permissionName(action, rule.profile, rule.path),
                "",
                source,
                { action, pattern } satisfies PermissionMetadata,
              ),
            );
          }
        }

        const domains = profileConfig.network?.domains;
        if (isRecord(domains)) {
          for (const [domain, mode] of Object.entries(domains)) {
            if (typeof mode !== "string") continue;
            const action = permissionActionFromMode(mode);
            const pattern = encodePermissionPattern(
              NETWORK_PERMISSION_PREFIX,
              profile,
              mode,
              domain,
            );
            resources.push(
              this.makeResource(
                "permission",
                permissionName(action, profile, domain),
                "",
                source,
                { action, pattern } satisfies PermissionMetadata,
              ),
            );
          }
        }
      }
    }

    const shellPolicy = config.shell_environment_policy;
    if (isRecord(shellPolicy) && isRecord(shellPolicy.set)) {
      for (const [key, value] of Object.entries(shellPolicy.set)) {
        if (typeof value !== "string") continue;
        resources.push(
          this.makeResource("env_var", key, "", source, {
            key,
            value,
          } satisfies EnvVarMetadata),
        );
      }
    }

    if (typeof config.model === "string" && config.model.length > 0) {
      const metadata: ModelConfigMetadata = {
        model: config.model,
        provider:
          typeof config.model_provider === "string"
            ? config.model_provider
            : undefined,
      };
      resources.push(
        this.makeResource("model_config", "default", "", source, metadata),
      );
    }

    return resources;
  }

  private scanConfigAt(
    configPath: string,
    source: string,
  ): ResourceCreateInput[] {
    const configContent = this.readFile(configPath);
    if (!configContent) return [];
    const config = parseCodexConfig(configContent);
    if (!config) return [];
    return this.scanConfigResources(config, source);
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    // 1. AGENTS.md
    const agentsMd = this.readFile(join(projectRoot, "AGENTS.md"));
    if (agentsMd) {
      resources.push(
        this.makeResource(
          "instruction",
          "codex-instructions",
          agentsMd,
          "AGENTS.md",
        ),
      );
    }

    // 2. Skills: .agents/skills/*/SKILL.md
    resources.push(...this.scanSkillsDir(projectRoot, ".agents/skills"));

    // 3. Agents: .codex/agents/*.toml
    resources.push(
      ...this.scanAgentFilesAt(
        join(projectRoot, ".codex", "agents"),
        ".codex/agents/",
        [".toml"],
      ),
    );

    // 4. Settings: .codex/config.toml
    resources.push(
      ...this.scanConfigAt(
        join(projectRoot, ".codex", "config.toml"),
        ".codex/config.toml",
      ),
    );

    // 5. Hooks: .codex/hooks.json
    resources.push(
      ...scanHooksFile(
        join(projectRoot, ".codex", "hooks.json"),
        ".codex/hooks.json",
      ),
    );

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const instructionsPath = join(homeRoot, ".codex", "AGENTS.md");
    const instructions = this.readFile(instructionsPath);
    if (instructions) {
      resources.push(
        this.makeResource(
          "instruction",
          "codex-instructions",
          instructions,
          "~/.codex/AGENTS.md",
        ),
      );
    }

    resources.push(
      ...this.scanSkillsDirAt(
        join(homeRoot, ".agents", "skills"),
        "~/.agents/skills",
      ),
    );

    resources.push(
      ...this.scanAgentFilesAt(
        join(homeRoot, ".codex", "agents"),
        "~/.codex/agents/",
        [".toml"],
      ),
    );

    resources.push(
      ...this.scanConfigAt(
        join(homeRoot, ".codex", "config.toml"),
        "~/.codex/config.toml",
      ),
    );

    return resources;
  }

  async serialize(
    resources: Resource[],
    projectRoot: string,
    options: SerializeOptions = {},
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];
    const target = options.target ?? "project";
    const targetPaths = this.getTargetPaths(target);
    const instructionsPath =
      this.toTargetRelativePath(targetPaths.instructions, target) ??
      (target === "project" ? "AGENTS.md" : undefined);
    const skillsPath =
      this.toTargetRelativePath(targetPaths.skills, target) ??
      (target === "project" ? ".agents/skills/" : undefined);
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);
    const configPath = this.toTargetRelativePath(
      targetPaths.settings ?? targetPaths.mcp,
      target,
    );
    const hooksPath = this.toTargetRelativePath(targetPaths.hooks, target);

    const instructions = resources.filter((r) => r.type === "instruction");
    const mcps = this.mcpServersForTarget(resources, configPath);
    const permissions = resources.filter((r) => r.type === "permission");
    const envVars = resources.filter((r) => r.type === "env_var");
    const modelConfigs = resources.filter((r) => r.type === "model_config");

    // Instructions → AGENTS.md
    if (instructions.length > 0 && instructionsPath) {
      files.push({
        path: instructionsPath,
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    // Skills → .agents/skills/{name}/SKILL.md
    for (const r of resources.filter((r) => r.type === "skill")) {
      if (!skillsPath) continue;
      files.push(
        ...this.emitSkillWithAuxiliary(
          r,
          `${skillsPath}${r.name}/SKILL.md`,
          options,
        ),
      );
    }

    // Agents → .codex/agents/{name}.toml
    for (const r of resources.filter((r) => r.type === "agent")) {
      if (!agentsPath) continue;
      const agent = canonicalAgentFromResource({
        name: r.name,
        description: r.description,
        content: r.content,
        metadata: r.metadata as AgentMetadata,
      });
      files.push({
        path: `${agentsPath}${r.name}.toml`,
        content: emitCodexAgentToml(agent),
      });
    }

    // Rules → append to AGENTS.md (Codex doesn't have a native rules system)
    const rules = resources.filter((r) => r.type === "rule");
    if (rules.length > 0 && instructions.length > 0 && instructionsPath) {
      const rulesSections = rules
        .map((r) => `## ${r.name}\n\n${r.content}`)
        .join("\n\n");
      const existing = files.find((f) => f.path === instructionsPath);
      if (existing) {
        existing.content += `\n\n${rulesSections}`;
      }
    } else if (rules.length > 0 && instructionsPath) {
      files.push({
        path: instructionsPath,
        content: rules.map((r) => `## ${r.name}\n\n${r.content}`).join("\n\n"),
      });
    }

    const managedResourceCount =
      mcps.length + permissions.length + envVars.length + modelConfigs.length;
    if (managedResourceCount > 0 && configPath) {
      const existingContent = this.readFile(join(projectRoot, configPath));
      const existing = existingContent
        ? (parseCodexConfig(existingContent) ?? {})
        : {};

      const overlay: CodexConfigDocument = {};

      if (mcps.length > 0) {
        overlay.mcp_servers = buildMcpServers(mcps);
      }

      if (permissions.length > 0) {
        overlay.permissions = buildPermissionProfiles(permissions);
      }

      if (envVars.length > 0) {
        const set: Record<string, string> = {};
        for (const resource of envVars) {
          const metadata = resource.metadata as EnvVarMetadata;
          set[metadata.key] = metadata.value;
        }
        overlay.shell_environment_policy = { set };
      }

      if (modelConfigs.length > 0) {
        const metadata = modelConfigs[0]?.metadata as ModelConfigMetadata;
        overlay.model = metadata.model;
        if (metadata.provider) {
          overlay.model_provider = metadata.provider;
        }
      }

      files.push({
        path: configPath,
        content: formatTransportToml(mergeConfigDocuments(existing, overlay)),
      });
    }

    const hooks = resources.filter((r) => r.type === "hook");
    if (hooksPath && hooks.length > 0) {
      files.push({
        path: hooksPath,
        content: JSON.stringify(
          buildHooksJson(
            hooks.map((r) => ({
              ...(r.metadata as HookMetadata),
              name: r.name,
            })),
          ),
          null,
          2,
        ),
      });
    }

    return files;
  }
}
