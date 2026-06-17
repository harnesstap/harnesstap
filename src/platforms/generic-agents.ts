import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import {
  canonicalAgentFromResource,
  emitMarkdownAgent,
} from "../services/agent-bridge.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import type {
  AgentMetadata,
  PlatformDefinition,
  ResourceCreateInput,
  Resource,
  SerializedFile,
  RuleMetadata,
  McpServerMetadata,
  HookMetadata,
  SerializeOptions,
} from "../types.js";

interface GenericMcpServerConfigEntry {
  url?: string;
  protocol?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface GenericMcpConfig {
  mcpServers?: Record<string, GenericMcpServerConfigEntry>;
}

interface GenericSerializedMcpEntry {
  url?: string;
  protocol?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

function resolveGlobalPath(homeRoot: string, configuredPath: string): string {
  return configuredPath.startsWith("~/")
    ? join(homeRoot, configuredPath.slice(2))
    : configuredPath;
}

/**
 * Generic serializer for platforms that follow standard configurations
 * including AGENTS.md, skills, mcp_config.json, rules, and hooks natively.
 */
export class GenericAgentsSerializer extends BaseSerializer {
  readonly platformId: string;
  readonly platform: PlatformDefinition;

  constructor(platformId: string) {
    super();
    this.platformId = platformId;
    const p = getPlatform(platformId);
    if (!p) throw new Error(`${platformId} platform not found in registry`);
    this.platform = p;
  }

  private scanRulesAt(fullPath: string, displayPath: string): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    if (displayPath.endsWith("/")) {
      for (const file of this.listDir(fullPath)) {
        if (!file.endsWith(".md") && !file.endsWith(".mdc")) continue;
        const raw = this.readFile(join(fullPath, file));
        if (!raw) continue;
        const parsed = this.tryParseFrontmatter(raw);
        if (!parsed) continue;
        const { data, content } = parsed;
        const metadata: RuleMetadata = {
          globs: Array.isArray(data["paths"])
            ? (data["paths"] as string[])
            : [],
          always_apply:
            !data["paths"] || (data["paths"] as string[]).length === 0,
        };
        resources.push(
          this.makeResource(
            "rule",
            file.replace(/\.md[c]?$/, ""),
            content.trim(),
            `${displayPath}${file}`,
            metadata,
          ),
        );
      }
    } else {
      const content = this.readFile(fullPath);
      if (content) {
        resources.push(
          this.makeResource("rule", "rule", content.trim(), displayPath, {
            globs: [],
            always_apply: true,
          }),
        );
      }
    }
    return resources;
  }

  private scanAgentsAt(fullPath: string, displayPath: string): ResourceCreateInput[] {
    return this.scanAgentFilesAt(fullPath, displayPath, [".md"]);
  }

  private scanHooksAt(fullPath: string, displayPath: string): ResourceCreateInput[] {
    return scanHooksFile(fullPath, displayPath);
  }

  private scanMcpAt(fullPath: string, displayPath: string): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    const content = this.readFile(fullPath);
    if (content) {
      try {
        const config = JSON.parse(content) as GenericMcpConfig;
        for (const [name, srv] of Object.entries(config.mcpServers || {})) {
          const transport =
            srv.url && srv.protocol === "sse" ? "http" : "stdio";
          const metadata: McpServerMetadata = {
            transport,
            command: srv.command,
            url: srv.url,
            args: srv.args,
            env: srv.env,
          };
          resources.push(
            this.makeResource("mcp_server", name, "", displayPath, metadata),
          );
        }
      } catch {
        // skip invalid json
      }
    }
    return resources;
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    // Instructions
    const instructionPath = this.platform.projectPaths.instructions;
    if (instructionPath) {
      const content = this.readFile(join(projectRoot, instructionPath));
      if (content) {
        resources.push(
          this.makeResource(
            "instruction",
            `${this.platformId}-instructions`,
            content,
            instructionPath,
          ),
        );
      }
    }

    // Skills
    const skillsPath = this.platform.projectPaths.skills;
    if (skillsPath) {
      resources.push(...this.scanSkillsDir(projectRoot, skillsPath));
    }

    // Rules
    const rulesPath = this.platform.projectPaths.rules;
    if (rulesPath) {
      resources.push(
        ...this.scanRulesAt(join(projectRoot, rulesPath), rulesPath),
      );
    }
    const legacyRulesPath = this.platform.projectPaths.legacy_rules;
    if (legacyRulesPath) {
      resources.push(
        ...this.scanRulesAt(
          join(projectRoot, legacyRulesPath),
          legacyRulesPath,
        ),
      );
    }

    // Agents
    const agentsPath = this.platform.projectPaths.agents;
    if (agentsPath) {
      resources.push(
        ...this.scanAgentsAt(join(projectRoot, agentsPath), agentsPath),
      );
    }

    // Hooks
    const hooksPath = this.platform.projectPaths.hooks;
    if (hooksPath) {
      resources.push(
        ...this.scanHooksAt(join(projectRoot, hooksPath), hooksPath),
      );
    }

    // MCP
    const mcpPath = this.platform.projectPaths.mcp;
    if (mcpPath) {
      resources.push(...this.scanMcpAt(join(projectRoot, mcpPath), mcpPath));
    }

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const instructionPath = this.platform.globalPaths.instructions;
    if (instructionPath) {
      const content = this.readFile(
        resolveGlobalPath(homeRoot, instructionPath),
      );
      if (content) {
        resources.push(
          this.makeResource(
            "instruction",
            `${this.platformId}-instructions`,
            content,
            instructionPath,
          ),
        );
      }
    }

    const skillsPath = this.platform.globalPaths.skills;
    if (skillsPath) {
      resources.push(
        ...this.scanSkillsDirAt(
          resolveGlobalPath(homeRoot, skillsPath),
          skillsPath.replace(/\/$/, ""),
        ),
      );
    }

    const rulesPath = this.platform.globalPaths.rules;
    if (rulesPath) {
      resources.push(
        ...this.scanRulesAt(
          resolveGlobalPath(homeRoot, rulesPath),
          rulesPath,
        ),
      );
    }

    const agentsPath = this.platform.globalPaths.agents;
    if (agentsPath) {
      resources.push(
        ...this.scanAgentsAt(
          resolveGlobalPath(homeRoot, agentsPath),
          agentsPath,
        ),
      );
    }

    const hooksPath = this.platform.globalPaths.hooks;
    if (hooksPath) {
      resources.push(
        ...this.scanHooksAt(
          resolveGlobalPath(homeRoot, hooksPath),
          hooksPath,
        ),
      );
    }

    const mcpPath = this.platform.globalPaths.settings;
    if (mcpPath) {
      resources.push(
        ...this.scanMcpAt(resolveGlobalPath(homeRoot, mcpPath), mcpPath),
      );
    }

    return resources;
  }

  async serialize(
    resources: Resource[],
    _projectRoot: string,
    options: SerializeOptions = {},
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];
    const target = options.target ?? "project";
    const targetPaths = this.getTargetPaths(target);
    const skillsPath =
      this.toTargetRelativePath(targetPaths.skills, target) ??
      (target === "project" ? ".agents/skills/" : undefined);
    const rulesPath = this.toTargetRelativePath(targetPaths.rules, target);
    const mcpPath = this.toTargetRelativePath(
      target === "global" ? targetPaths.settings : targetPaths.mcp,
      target,
    );
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);
    const hooksPath = this.toTargetRelativePath(targetPaths.hooks, target);
    const instructionPath =
      this.toTargetRelativePath(targetPaths.instructions, target) ??
      (target === "project" ? "AGENTS.md" : undefined);

    // Instructions
    const instructions = resources.filter((r) => r.type === "instruction");
    // Only embed rules into AGENTS.md if there is natively no rules feature support
    const rules = resources.filter((r) => r.type === "rule");

    if ((instructions.length > 0 || (!rulesPath && rules.length > 0)) && instructionPath) {
      const parts: string[] = [];
      for (const r of instructions) parts.push(r.content);
      if (!rulesPath) {
        for (const r of rules) parts.push(`## ${r.name}\n\n${r.content}`);
      }
      files.push({
        path: instructionPath,
        content: parts.join("\n\n"),
      });
    }

    // Rules native files
    if (rulesPath && rules.length > 0) {
      if (rulesPath.endsWith("/")) {
        for (const r of rules) {
          const md = r.metadata as RuleMetadata;
          const fm: Record<string, unknown> = {
            description: r.description || `Rule ${r.name}`,
          };
          if (md?.globs && md.globs.length > 0) {
            fm["paths"] = md.globs;
          }
          files.push({
            path: `${rulesPath}${r.name}.md`,
            content: this.emitFrontmatter(fm, r.content),
          });
        }
      } else {
        const parts: string[] = [];
        for (const r of rules) parts.push(`## ${r.name}\n\n${r.content}`);
        files.push({ path: rulesPath, content: parts.join("\n\n") });
      }
    }

    // Agents
    const agents = resources.filter((r) => r.type === "agent");
    if (agentsPath && agents.length > 0 && agentsPath.endsWith("/")) {
      for (const r of agents) {
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
    }

    // Hooks
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
            { version: 1 },
          ),
          null,
          2,
        ),
      });
    }

    // Skills
    const skills = resources.filter((r) => r.type === "skill");
    const instructionOnlySkills =
      this.platform.skillEmission === "instruction-only";
    const instructionOnlySink = Boolean(rulesPath || instructionPath);

    if (instructionOnlySkills && instructionOnlySink && rulesPath && skills.length > 0) {
      if (rulesPath.endsWith("/")) {
        for (const r of skills) {
          const fm: Record<string, unknown> = {
            description: r.description || `Skill ${r.name}`,
          };
          files.push({
            path: `${rulesPath}${r.name}.md`,
            content: this.emitFrontmatter(fm, r.content),
          });
        }
      } else {
        const parts: string[] = [];
        for (const r of skills) {
          parts.push(`## ${r.name}\n\n${r.content}`);
        }
        files.push({ path: rulesPath, content: parts.join("\n\n") });
      }
    } else if (
      skillsPath &&
      (!instructionOnlySkills || !instructionOnlySink) &&
      skills.length > 0
    ) {
      for (const r of skills) {
        files.push(
          ...this.emitSkillWithAuxiliary(
            r,
            `${skillsPath}${r.name}/SKILL.md`,
            options,
          ),
        );
      }
    }

    // MCP
    const mcpServers = resources.filter((r) => r.type === "mcp_server");
    if (mcpPath && mcpServers.length > 0) {
      const servers: Record<string, GenericSerializedMcpEntry> = {};
      for (const r of mcpServers) {
        const meta = r.metadata as McpServerMetadata;
        if (!meta) continue;
        if (meta.transport === "http") {
          servers[r.name] = { url: meta.url, protocol: "sse", env: meta.env };
        } else {
          servers[r.name] = {
            command: meta.command,
            args: meta.args,
            env: meta.env,
          };
        }
      }
      files.push({
        path: mcpPath,
        content: JSON.stringify({ mcpServers: servers }, null, 2),
      });
    }

    return files;
  }
}
