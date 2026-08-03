import { join } from "node:path";
import { parse } from "smol-toml";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { formatTransportToml } from "../services/transport/write.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import {
  canonicalAgentFromResource,
  emitMarkdownAgent,
} from "../services/agent-bridge.js";
import type {
  AgentMetadata,
  HookMetadata,
  McpServerMetadata,
  ModelConfigMetadata,
  PermissionMetadata,
  PlatformDefinition,
  Resource,
  ResourceCreateInput,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

type GrokConfigDocument = Record<string, unknown>;

interface GrokMcpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  cwd?: string;
  bearer_token_env_var?: string;
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
}

interface GrokPermissionRule {
  action?: string;
  tool?: string;
  pattern?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGrokConfig(content: string): GrokConfigDocument | undefined {
  try {
    const parsed = parse(content);
    if (!isRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function permissionName(action: PermissionMetadata["action"], pattern: string): string {
  const slug = pattern.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${action}-${slug || "rule"}`;
}

function compactPermissionPattern(tool: string, pattern?: string): string {
  if (!pattern || pattern.length === 0) return tool;
  return `${tool}(${pattern})`;
}

function mergeConfigDocuments(
  existing: GrokConfigDocument,
  overlay: GrokConfigDocument,
): GrokConfigDocument {
  const merged: GrokConfigDocument = { ...existing };

  for (const [key, value] of Object.entries(overlay)) {
    if (key === "mcp_servers" && isRecord(value) && isRecord(merged.mcp_servers)) {
      merged.mcp_servers = { ...merged.mcp_servers, ...value };
      continue;
    }
    if (key === "permission" && isRecord(value) && isRecord(merged.permission)) {
      merged.permission = { ...merged.permission, ...value };
      continue;
    }
    if (key === "models" && isRecord(value) && isRecord(merged.models)) {
      merged.models = { ...merged.models, ...value };
      continue;
    }
    merged[key] = value;
  }

  return merged;
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
      if (metadata.headers && Object.keys(metadata.headers).length > 0) {
        entry.headers = metadata.headers;
      }
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

function buildPermissionSection(
  permissions: Resource[],
): Record<string, unknown> {
  const allow: string[] = [];
  const deny: string[] = [];
  const ask: string[] = [];

  for (const resource of permissions) {
    const metadata = resource.metadata as PermissionMetadata;
    switch (metadata.action) {
      case "allow":
        allow.push(metadata.pattern);
        break;
      case "deny":
        deny.push(metadata.pattern);
        break;
      case "ask":
        ask.push(metadata.pattern);
        break;
      default: {
        const _exhaustive: never = metadata.action;
        void _exhaustive;
        break;
      }
    }
  }

  const section: Record<string, unknown> = {};
  if (allow.length > 0) section.allow = allow;
  if (deny.length > 0) section.deny = deny;
  if (ask.length > 0) section.ask = ask;
  return section;
}

function hooksOutputPath(hooksPath: string): string {
  if (hooksPath.endsWith("/")) {
    return `${hooksPath}harnesstap.json`;
  }
  return hooksPath;
}

function resolveGlobalPath(homeRoot: string, configuredPath: string): string {
  return configuredPath.startsWith("~/")
    ? join(homeRoot, configuredPath.slice(2))
    : configuredPath;
}

/**
 * Native serializer for Grok Build (`.grok/` layout + `config.toml`).
 */
export class GrokBuildSerializer extends BaseSerializer {
  readonly platformId = "grok-build";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const platform = getPlatform("grok-build");
    if (!platform) throw new Error("grok-build platform not found in registry");
    this.platform = platform;
  }

  private scanConfigResources(
    config: GrokConfigDocument,
    source: string,
    options: { includeModels: boolean },
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];

    const mcpServers = config.mcp_servers;
    if (isRecord(mcpServers)) {
      for (const [name, entryValue] of Object.entries(mcpServers)) {
        if (!isRecord(entryValue)) continue;
        const entry = entryValue as GrokMcpServerEntry;
        const metadata: McpServerMetadata = {
          transport: entry.url ? "http" : "stdio",
          command: entry.command,
          args: entry.args,
          url: entry.url,
          env: entry.env,
          headers: entry.headers,
        };
        resources.push(
          this.makeResource("mcp_server", name, "", source, metadata),
        );
      }
    }

    const permission = config.permission;
    if (isRecord(permission)) {
      for (const action of ["allow", "deny", "ask"] as const) {
        const patterns = permission[action];
        if (!Array.isArray(patterns)) continue;
        for (const pattern of patterns) {
          if (typeof pattern !== "string" || pattern.length === 0) continue;
          resources.push(
            this.makeResource(
              "permission",
              permissionName(action, pattern),
              "",
              source,
              { action, pattern } satisfies PermissionMetadata,
            ),
          );
        }
      }

      const rules = permission.rules;
      if (Array.isArray(rules)) {
        for (const ruleValue of rules) {
          if (!isRecord(ruleValue)) continue;
          const rule = ruleValue as GrokPermissionRule;
          if (
            rule.action !== "allow" &&
            rule.action !== "deny" &&
            rule.action !== "ask"
          ) {
            continue;
          }
          if (typeof rule.tool !== "string" || rule.tool.length === 0) continue;
          const pattern = compactPermissionPattern(rule.tool, rule.pattern);
          resources.push(
            this.makeResource(
              "permission",
              permissionName(rule.action, pattern),
              "",
              source,
              { action: rule.action, pattern } satisfies PermissionMetadata,
            ),
          );
        }
      }
    }

    if (options.includeModels && isRecord(config.models)) {
      const defaultModel = config.models.default;
      if (typeof defaultModel === "string" && defaultModel.length > 0) {
        resources.push(
          this.makeResource("model_config", "default", "", source, {
            model: defaultModel,
          } satisfies ModelConfigMetadata),
        );
      }
    }

    return resources;
  }

  private scanConfigAt(
    fullPath: string,
    displayPath: string,
    options: { includeModels: boolean },
  ): ResourceCreateInput[] {
    const content = this.readFile(fullPath);
    if (!content) return [];
    const config = parseGrokConfig(content);
    if (!config) return [];
    return this.scanConfigResources(config, displayPath, options);
  }

  private scanHooksDir(
    fullPath: string,
    displayPath: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    const prefix = displayPath.endsWith("/") ? displayPath : `${displayPath}/`;

    for (const file of this.listDir(fullPath)) {
      if (!file.endsWith(".json")) continue;
      resources.push(
        ...scanHooksFile(join(fullPath, file), `${prefix}${file}`),
      );
    }

    return resources;
  }

  private scanCommandsAt(
    fullPath: string,
    displayPath: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    const prefix = displayPath.endsWith("/") ? displayPath : `${displayPath}/`;

    for (const file of this.listDir(fullPath)) {
      if (!file.endsWith(".md")) continue;
      const content = this.readFile(join(fullPath, file));
      if (!content) continue;
      resources.push(
        this.makeResource(
          "command",
          file.replace(/\.md$/, ""),
          content,
          `${prefix}${file}`,
        ),
      );
    }

    return resources;
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const instructionPath = this.platform.projectPaths.instructions ?? "AGENTS.md";
    const instructions = this.readFile(join(projectRoot, instructionPath));
    if (instructions) {
      resources.push(
        this.makeResource(
          "instruction",
          "grok-build-instructions",
          instructions,
          instructionPath,
        ),
      );
    } else {
      for (const alternate of this.platform.projectPaths.pathAlternates?.instructions ?? []) {
        const content = this.readFile(join(projectRoot, alternate));
        if (!content) continue;
        resources.push(
          this.makeResource(
            "instruction",
            "grok-build-instructions",
            content,
            alternate,
          ),
        );
        break;
      }
    }

    const skillsPath = this.platform.projectPaths.skills ?? ".grok/skills/";
    resources.push(...this.scanSkillsDir(projectRoot, skillsPath));
    for (const alternate of this.platform.projectPaths.pathAlternates?.skills ?? []) {
      resources.push(...this.scanSkillsDir(projectRoot, alternate));
    }

    const agentsPath = this.platform.projectPaths.agents ?? ".grok/agents/";
    resources.push(
      ...this.scanAgentFilesAt(
        join(projectRoot, agentsPath),
        agentsPath,
        [".md"],
      ),
    );

    const hooksPath = this.platform.projectPaths.hooks ?? ".grok/hooks/";
    resources.push(
      ...this.scanHooksDir(join(projectRoot, hooksPath), hooksPath),
    );

    const commandsPath = this.platform.projectPaths.commands;
    if (commandsPath) {
      resources.push(
        ...this.scanCommandsAt(join(projectRoot, commandsPath), commandsPath),
      );
    }

    const configPath =
      this.platform.projectPaths.settings ??
      this.platform.projectPaths.mcp ??
      ".grok/config.toml";
    resources.push(
      ...this.scanConfigAt(join(projectRoot, configPath), configPath, {
        includeModels: false,
      }),
    );

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const skillsPath = this.platform.globalPaths.skills ?? "~/.grok/skills/";
    resources.push(
      ...this.scanSkillsDirAt(
        resolveGlobalPath(homeRoot, skillsPath),
        skillsPath.replace(/\/$/, ""),
      ),
    );
    for (const alternate of this.platform.globalPaths.pathAlternates?.skills ?? []) {
      resources.push(
        ...this.scanSkillsDirAt(
          resolveGlobalPath(homeRoot, alternate),
          alternate.replace(/\/$/, ""),
        ),
      );
    }

    const agentsPath = this.platform.globalPaths.agents ?? "~/.grok/agents/";
    resources.push(
      ...this.scanAgentFilesAt(
        resolveGlobalPath(homeRoot, agentsPath),
        agentsPath,
        [".md"],
      ),
    );

    const hooksPath = this.platform.globalPaths.hooks ?? "~/.grok/hooks/";
    resources.push(
      ...this.scanHooksDir(resolveGlobalPath(homeRoot, hooksPath), hooksPath),
    );

    const commandsPath = this.platform.globalPaths.commands;
    if (commandsPath) {
      resources.push(
        ...this.scanCommandsAt(
          resolveGlobalPath(homeRoot, commandsPath),
          commandsPath,
        ),
      );
    }

    const configPath =
      this.platform.globalPaths.settings ?? "~/.grok/config.toml";
    resources.push(
      ...this.scanConfigAt(
        resolveGlobalPath(homeRoot, configPath),
        configPath,
        { includeModels: true },
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
      (target === "project" ? ".grok/skills/" : undefined);
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);
    const hooksPath = this.toTargetRelativePath(targetPaths.hooks, target);
    const commandsPath = this.toTargetRelativePath(targetPaths.commands, target);
    const configPath = this.toTargetRelativePath(
      targetPaths.settings ?? targetPaths.mcp,
      target,
    );

    const instructions = resources.filter((r) => r.type === "instruction");
    if (instructions.length > 0 && instructionsPath) {
      files.push({
        path: instructionsPath,
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

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

    for (const r of resources.filter((r) => r.type === "agent")) {
      if (!agentsPath) continue;
      files.push({
        path: `${agentsPath}${r.name}.md`,
        content: emitMarkdownAgent(
          canonicalAgentFromResource({
            name: r.name,
            description: r.description,
            content: r.content,
            metadata: r.metadata as AgentMetadata,
          }),
          "generic",
        ),
      });
    }

    const commands = resources.filter((r) => r.type === "command");
    if (commandsPath && commands.length > 0) {
      const prefix = commandsPath.endsWith("/")
        ? commandsPath
        : `${commandsPath}/`;
      for (const r of commands) {
        files.push({
          path: `${prefix}${r.name}.md`,
          content: r.content,
        });
      }
    }

    const mcps = this.mcpServersForTarget(resources, configPath);
    const permissions = resources.filter((r) => r.type === "permission");
    const modelConfigs = resources.filter((r) => r.type === "model_config");
    const managedCount =
      mcps.length +
      permissions.length +
      (target === "global" ? modelConfigs.length : 0);

    if (managedCount > 0 && configPath) {
      const existingContent = this.readFile(join(projectRoot, configPath));
      const existing = existingContent
        ? (parseGrokConfig(existingContent) ?? {})
        : {};
      const overlay: GrokConfigDocument = {};

      if (mcps.length > 0) {
        overlay.mcp_servers = buildMcpServers(mcps);
      }
      if (permissions.length > 0) {
        overlay.permission = buildPermissionSection(permissions);
      }
      if (target === "global" && modelConfigs.length > 0) {
        const metadata = modelConfigs[0]?.metadata as ModelConfigMetadata;
        overlay.models = { default: metadata.model };
      }

      files.push({
        path: configPath,
        content: formatTransportToml(mergeConfigDocuments(existing, overlay)),
      });
    }

    const hooks = resources.filter((r) => r.type === "hook");
    if (hooksPath && hooks.length > 0) {
      files.push({
        path: hooksOutputPath(hooksPath),
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
