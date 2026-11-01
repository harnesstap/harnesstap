import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { listInstalledCopilotPluginPinCreateInputs } from "../plugins/copilot-installed.js";
import { serializedAgentDocument } from "../services/agent-bridge.js";
import { parseMcpServersDocument } from "../services/mcp-config-bridge.js";
import type {
  AgentMetadata,
  PlatformDefinition,
  ResourceCreateInput,
  Resource,
  SerializedFile,
  McpServerMetadata,
  RuleMetadata,
  SerializeOptions,
} from "../types.js";

const INSTRUCTIONS_FILE_SUFFIX = ".instructions.md";

/**
 * `applyTo` is a comma separated glob list; `"**"` applies to every file.
 * https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
 */
function parseApplyTo(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw.map((glob) => glob.trim()).filter((glob) => glob.length > 0);
}

interface CopilotSerializedMcpEntry {
  type: "http" | "local";
  tools: string[];
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  cwd?: string;
}

export class CopilotSerializer extends BaseSerializer {
  constructor(readonly platformId: "github-copilot" | "copilot-cli") {
    super();
    const p = getPlatform(platformId);
    if (!p) throw new Error(`${platformId} platform not found in registry`);
    this.platform = p;
  }

  readonly platform: PlatformDefinition;

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    // 1. Instructions
    if (this.platform.projectPaths.instructions) {
      const instrPath = join(
        projectRoot,
        this.platform.projectPaths.instructions,
      );
      const content = this.readFile(instrPath);
      if (content) {
        resources.push(
          this.makeResource(
            "instruction",
            `${this.platformId}-instructions`,
            content,
            this.platform.projectPaths.instructions,
          ),
        );
      }
    }

    // 2. Skills
    if (this.platform.projectPaths.skills) {
      resources.push(
        ...this.scanSkillsDir(projectRoot, this.platform.projectPaths.skills),
      );
    }

    // 3. Agents
    if (this.platform.projectPaths.agents) {
      const agentsPath = this.platform.projectPaths.agents;
      resources.push(
        ...this.scanAgentFilesAt(
          join(projectRoot, agentsPath),
          agentsPath.endsWith("/") ? agentsPath : `${agentsPath}/`,
          [".md"],
        ),
      );
    }

    // 4. Path-scoped instructions (`.github/instructions/*.instructions.md`)
    const rulesPath = this.platform.projectPaths.rules;
    if (rulesPath) {
      const prefix = rulesPath.endsWith("/") ? rulesPath : `${rulesPath}/`;
      for (const file of this.listDir(join(projectRoot, rulesPath))) {
        if (!file.endsWith(INSTRUCTIONS_FILE_SUFFIX)) continue;
        const raw = this.readFile(join(projectRoot, rulesPath, file));
        if (!raw) continue;
        const parsed = this.tryParseFrontmatter(raw);
        if (!parsed) continue;
        const applyTo = parseApplyTo(parsed.data["applyTo"]);
        const everyFile = applyTo.length === 0 || applyTo.every((glob) => glob === "**");
        const metadata: RuleMetadata = {
          globs: everyFile ? [] : applyTo,
          always_apply: everyFile,
        };
        resources.push(
          this.makeResource(
            "rule",
            file.slice(0, -INSTRUCTIONS_FILE_SUFFIX.length),
            parsed.content.trim(),
            `${prefix}${file}`,
            metadata,
            typeof parsed.data["description"] === "string" ? parsed.data["description"] : "",
          ),
        );
      }
    }

    // 5. MCP servers
    if (this.platform.projectPaths.mcp) {
      const configPathValue = this.platform.projectPaths.mcp;
      const configPath = join(projectRoot, configPathValue);
      const configContent = this.readFile(configPath);
      if (configContent) {
        try {
          const document = JSON.parse(configContent) as unknown;
          for (const [name, metadata] of Object.entries(
            parseMcpServersDocument(document),
          )) {
            resources.push(
              this.makeResource(
                "mcp_server",
                name,
                "",
                configPathValue,
                metadata,
              ),
            );
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    // Global skills
    if (this.platform.globalPaths.skills) {
      const skillsDir = this.resolveHomePath(
        homeRoot,
        this.platform.globalPaths.skills,
      );
      resources.push(
        ...this.scanSkillsDirAt(skillsDir, this.platform.globalPaths.skills),
      );
    }

    // Global config (MCP)
    if (this.platform.globalPaths.settings) {
      const settingsPath = this.platform.globalPaths.settings;
      const configPath = this.resolveHomePath(homeRoot, settingsPath);
      const configContent = this.readFile(configPath);
      if (configContent) {
        try {
          const document = JSON.parse(configContent) as unknown;
          for (const [name, metadata] of Object.entries(
            parseMcpServersDocument(document),
          )) {
            resources.push(
              this.makeResource(
                "mcp_server",
                name,
                "",
                settingsPath,
                metadata,
              ),
            );
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }

    if (this.platform.globalPaths.plugins) {
      resources.push(...listInstalledCopilotPluginPinCreateInputs(homeRoot));
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
    const instructionsPath = this.toTargetRelativePath(targetPaths.instructions, target);
    const skillsPath = this.toTargetRelativePath(targetPaths.skills, target);
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);
    const rulesPath = this.toTargetRelativePath(targetPaths.rules, target);
    const mcpPath = this.toTargetRelativePath(
      target === "global" ? targetPaths.settings : targetPaths.mcp,
      target,
    );

    // Instructions (and instruction-only skills merged for copilot)
    const instructions = resources.filter((r) => r.type === "instruction");
    const skills = resources.filter((r) => r.type === "skill");
    const instructionOnlySkills =
      this.platform.skillEmission === "instruction-only";
    const instructionOnlySink = Boolean(instructionsPath);

    if (instructions.length > 0 && instructionsPath) {
      const parts: string[] = instructions.map((r) => r.content);
      if (instructionOnlySkills) {
        for (const r of skills) {
          parts.push(`## ${r.name}\n\n${r.content}`);
        }
      }
      files.push({
        path: instructionsPath,
        content: parts.join("\n\n"),
      });
    } else if (instructionOnlySkills && skills.length > 0 && instructionsPath) {
      const parts = skills.map((r) => `## ${r.name}\n\n${r.content}`);
      files.push({
        path: instructionsPath,
        content: parts.join("\n\n"),
      });
    }

    // Skills (native emission when not instruction-only, or no instruction sink)
    if (
      skillsPath &&
      (!instructionOnlySkills || !instructionOnlySink) &&
      skills.length > 0
    ) {
      for (const r of skills) {
        files.push(
          ...this.emitSkillWithAuxiliary(
            r,
            join(skillsPath, r.name, "SKILL.md"),
            options,
          ),
        );
      }
    }

    // Agents
    const agents = resources.filter((r) => r.type === "agent");
    if (agentsPath && agents.length > 0) {
      const agentsDir = agentsPath.endsWith("/") ? agentsPath : `${agentsPath}/`;
      for (const r of agents) {
        files.push({
          path: join(agentsDir, `${r.name}.md`),
          content: serializedAgentDocument(
            {
              name: r.name,
              description: r.description,
              content: r.content,
              metadata: r.metadata as AgentMetadata,
            },
            "generic",
          ),
        });
      }
    }

    // MCP servers
    const mcps = this.mcpServersForTarget(resources, mcpPath);
    if (mcps.length > 0 && mcpPath) {
      const mcpServers: Record<string, CopilotSerializedMcpEntry> = {};
      for (const r of mcps) {
        const meta = r.metadata as McpServerMetadata;
        if (meta.transport === "http" || meta.url) {
          mcpServers[r.name] = {
            type: "http",
            url: meta.url,
            tools: meta.enabled_tools ?? ["*"],
            ...(meta.headers && Object.keys(meta.headers).length > 0
              ? { headers: meta.headers }
              : {}),
          };
        } else {
          mcpServers[r.name] = {
            type: "local",
            command: meta.command,
            args: meta.args,
            env: meta.env,
            tools: meta.enabled_tools ?? ["*"],
            ...(meta.cwd ? { cwd: meta.cwd } : {}),
          };
        }
      }
      files.push({
        path: mcpPath,
        content: JSON.stringify({ mcpServers }, null, 2),
      });
    }

    // Path-scoped rules become `<name>.instructions.md` with `applyTo` globs.
    const rules = resources.filter((r) => r.type === "rule");
    if (rulesPath && rules.length > 0) {
      const prefix = rulesPath.endsWith("/") ? rulesPath : `${rulesPath}/`;
      for (const r of rules) {
        const meta = (r.metadata ?? {}) as Partial<RuleMetadata>;
        const globs = Array.isArray(meta.globs) ? meta.globs.filter((glob) => glob.length > 0) : [];
        const frontmatter: Record<string, unknown> = {
          applyTo: globs.length > 0 ? globs.join(",") : "**",
          ...(r.description ? { description: r.description } : {}),
        };
        files.push({
          path: `${prefix}${r.name}${INSTRUCTIONS_FILE_SUFFIX}`,
          content: this.emitFrontmatter(frontmatter, r.content),
        });
      }
    }

    return files;
  }
}
