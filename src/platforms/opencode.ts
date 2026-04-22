import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type {
  PlatformDefinition,
  Resource,
  SerializedFile,
  McpServerMetadata,
} from "../types.js";

export class OpenCodeSerializer extends BaseSerializer {
  readonly platformId = "opencode";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const p = getPlatform("opencode");
    if (!p) throw new Error("opencode platform not found in registry");
    this.platform = p;
  }

  async scan(projectRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

    // 1. Instructions: AGENTS.md
    const agentsMd = this.readFile(join(projectRoot, "AGENTS.md"));
    if (agentsMd) {
      resources.push(
        this.makeResource(
          "instruction",
          "opencode-instructions",
          agentsMd,
          "AGENTS.md",
        ),
      );
    }

    // 2. Skills: .opencode/skills/
    resources.push(...this.scanSkillsDir(projectRoot, ".opencode/skills"));

    // 2.1 Agents: .opencode/agents/
    const agentsDir = join(projectRoot, ".opencode", "agents");
    for (const file of this.listDir(agentsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = this.readFile(join(agentsDir, file));
      if (!content) continue;
      const name = file.replace(/\.md$/, "");
      resources.push(
        this.makeResource("agent", name, content, `.opencode/agents/${file}`),
      );
    }

    // 2.2 Commands: .opencode/commands/
    const commandsDir = join(projectRoot, ".opencode", "commands");
    for (const file of this.listDir(commandsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = this.readFile(join(commandsDir, file));
      if (!content) continue;
      const name = file.replace(/\.md$/, "");
      resources.push(
        this.makeResource(
          "command",
          name,
          content,
          `.opencode/commands/${file}`,
        ),
      );
    }

    // 3. MCP servers: opencode.json
    const configPath = join(projectRoot, "opencode.json");
    const configContent = this.readFile(configPath);
    if (configContent) {
      try {
        const config = JSON.parse(configContent);
        if (config.mcp) {
          for (const [name, mcp] of Object.entries(config.mcp)) {
            const m = mcp as any;
            const metadata: McpServerMetadata = {
              transport: m.type === "remote" ? "http" : "stdio",
              command: Array.isArray(m.command) ? m.command[0] : m.command,
              args: Array.isArray(m.command) ? m.command.slice(1) : undefined,
              url: m.url,
              env: m.environment || m.env,
            };
            resources.push(
              this.makeResource(
                "mcp_server",
                name,
                "",
                "opencode.json",
                metadata,
              ),
            );
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }

    return resources as Resource[];
  }

  async scanGlobal(homeRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

    // Global skills
    resources.push(
      ...this.scanSkillsDirAt(
        join(homeRoot, ".config", "opencode", "skills"),
        "~/.config/opencode/skills",
      ),
    );

    // Global agents
    const globalAgentsDir = join(homeRoot, ".config", "opencode", "agents");
    for (const file of this.listDir(globalAgentsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = this.readFile(join(globalAgentsDir, file));
      if (!content) continue;
      const name = file.replace(/\.md$/, "");
      resources.push(
        this.makeResource(
          "agent",
          name,
          content,
          `~/.config/opencode/agents/${file}`,
        ),
      );
    }

    // Global commands
    const globalCommandsDir = join(homeRoot, ".config", "opencode", "commands");
    for (const file of this.listDir(globalCommandsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = this.readFile(join(globalCommandsDir, file));
      if (!content) continue;
      const name = file.replace(/\.md$/, "");
      resources.push(
        this.makeResource(
          "command",
          name,
          content,
          `~/.config/opencode/commands/${file}`,
        ),
      );
    }

    // Global config
    const configPath = join(homeRoot, ".config", "opencode", "opencode.json");
    const configContent = this.readFile(configPath);
    if (configContent) {
      try {
        const config = JSON.parse(configContent);
        if (config.mcp) {
          for (const [name, mcp] of Object.entries(config.mcp)) {
            const m = mcp as any;
            const metadata: McpServerMetadata = {
              transport: m.type === "remote" ? "http" : "stdio",
              command: Array.isArray(m.command) ? m.command[0] : m.command,
              args: Array.isArray(m.command) ? m.command.slice(1) : undefined,
              url: m.url,
              env: m.environment || m.env,
            };
            resources.push(
              this.makeResource(
                "mcp_server",
                name,
                "",
                "~/.config/opencode/opencode.json",
                metadata,
              ),
            );
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }

    return resources as Resource[];
  }

  async serialize(
    resources: Resource[],
    _projectRoot: string,
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];

    // Group by type
    const instructions = resources.filter((r) => r.type === "instruction");
    const skills = resources.filter((r) => r.type === "skill");
    const mcps = resources.filter((r) => r.type === "mcp_server");
    const agents = resources.filter((r) => r.type === "agent");
    const commands = resources.filter((r) => r.type === "command");

    // AGENTS.md
    if (instructions.length > 0) {
      files.push({
        path: "AGENTS.md",
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    // .opencode/skills/
    for (const r of skills) {
      const fm: Record<string, unknown> = {
        name: r.name,
        description: r.description,
      };
      files.push({
        path: `.opencode/skills/${r.name}/SKILL.md`,
        content: this.emitFrontmatter(fm, r.content),
      });
    }

    // .opencode/agents/
    for (const r of agents) {
      files.push({
        path: `.opencode/agents/${r.name}.md`,
        content: r.content,
      });
    }

    // .opencode/commands/
    for (const r of commands) {
      files.push({
        path: `.opencode/commands/${r.name}.md`,
        content: r.content,
      });
    }

    // opencode.json
    if (mcps.length > 0) {
      const mcpConfig: Record<string, any> = {};
      for (const r of mcps) {
        const meta = r.metadata as McpServerMetadata;
        if (meta.transport === "http" || meta.url) {
          mcpConfig[r.name] = {
            type: "remote",
            url: meta.url,
            enabled: true,
          };
        } else {
          const command = [meta.command];
          if (meta.args) command.push(...meta.args);
          mcpConfig[r.name] = {
            type: "local",
            command: command.length === 1 ? command[0] : command,
            environment: meta.env,
            enabled: true,
          };
        }
      }
      files.push({
        path: "opencode.json",
        content: JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            mcp: mcpConfig,
          },
          null,
          2,
        ),
      });
    }

    return files;
  }
}
