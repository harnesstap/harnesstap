import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type {
  PlatformDefinition,
  Resource,
  SerializedFile,
  McpServerMetadata,
} from "../types.js";

export class CopilotSerializer extends BaseSerializer {
  constructor(readonly platformId: "github-copilot" | "copilot-cli") {
    super();
    const p = getPlatform(platformId);
    if (!p) throw new Error(`${platformId} platform not found in registry`);
    this.platform = p;
  }

  readonly platform: PlatformDefinition;

  async scan(projectRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

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

    // 3. MCP servers
    if (this.platform.projectPaths.mcp) {
      const configPath = join(projectRoot, this.platform.projectPaths.mcp);
      const configContent = this.readFile(configPath);
      if (configContent) {
        try {
          const config = JSON.parse(configContent);
          const servers = config.mcpServers || config.mcp; // Support both
          if (servers) {
            for (const [name, mcp] of Object.entries(servers)) {
              const m = mcp as any;
              const metadata: McpServerMetadata = {
                transport: m.type === "http" ? "http" : "stdio",
                command: m.command,
                args: m.args,
                url: m.url,
                env: m.env,
              };
              resources.push(
                this.makeResource(
                  "mcp_server",
                  name,
                  "",
                  this.platform.projectPaths.mcp!,
                  metadata,
                ),
              );
            }
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }

    return resources as Resource[];
  }

  async scanGlobal(homeRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

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
      const configPath = this.resolveHomePath(
        homeRoot,
        this.platform.globalPaths.settings,
      );
      const configContent = this.readFile(configPath);
      if (configContent) {
        try {
          const config = JSON.parse(configContent);
          const servers = config.mcpServers || config.mcp;
          if (servers) {
            for (const [name, mcp] of Object.entries(servers)) {
              const m = mcp as any;
              const metadata: McpServerMetadata = {
                transport: m.type === "http" ? "http" : "stdio",
                command: m.command,
                args: m.args,
                url: m.url,
                env: m.env,
              };
              resources.push(
                this.makeResource(
                  "mcp_server",
                  name,
                  "",
                  this.platform.globalPaths.settings!,
                  metadata,
                ),
              );
            }
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }

    return resources as Resource[];
  }

  async serialize(
    resources: Resource[],
    _projectRoot: string,
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];

    // Instructions
    const instructions = resources.filter((r) => r.type === "instruction");
    if (instructions.length > 0 && this.platform.projectPaths.instructions) {
      files.push({
        path: this.platform.projectPaths.instructions,
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    // Skills
    const skills = resources.filter((r) => r.type === "skill");
    if (this.platform.projectPaths.skills) {
      for (const r of skills) {
        const fm: Record<string, unknown> = {
          name: r.name,
          description: r.description,
        };
        files.push({
          path: join(this.platform.projectPaths.skills, r.name, "SKILL.md"),
          content: this.emitFrontmatter(fm, r.content),
        });
      }
    }

    // MCP servers
    const mcps = resources.filter((r) => r.type === "mcp_server");
    if (mcps.length > 0 && this.platform.projectPaths.mcp) {
      const mcpServers: Record<string, any> = {};
      for (const r of mcps) {
        const meta = r.metadata as McpServerMetadata;
        if (meta.transport === "http" || meta.url) {
          mcpServers[r.name] = {
            type: "http",
            url: meta.url,
            tools: ["*"],
          };
        } else {
          mcpServers[r.name] = {
            type: "local",
            command: meta.command,
            args: meta.args,
            env: meta.env,
            tools: ["*"],
          };
        }
      }
      files.push({
        path: this.platform.projectPaths.mcp,
        content: JSON.stringify({ mcpServers }, null, 2),
      });
    }

    return files;
  }
}
