import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import {
  canonicalAgentFromResource,
  emitMarkdownAgent,
} from "../services/agent-bridge.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import {
  emitCursorMcpServerEntry,
  parseMcpServersDocument,
} from "../services/mcp-config-bridge.js";
import type {
  AgentMetadata,
  HookMetadata,
  McpServerMetadata,
  PlatformDefinition,
  Resource,
  ResourceCreateInput,
  SerializedFile,
  RuleMetadata,
  SerializeOptions,
} from "../types.js";

export class CursorSerializer extends BaseSerializer {
  readonly platformId = "cursor";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const p = getPlatform("cursor");
    if (!p) throw new Error("cursor platform not found in registry");
    this.platform = p;
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    // 1. Legacy .cursorrules
    const legacyContent = this.readFile(join(projectRoot, ".cursorrules"));
    if (legacyContent) {
      resources.push(
        this.makeResource(
          "instruction",
          "cursorrules",
          legacyContent,
          ".cursorrules",
        ),
      );
    }

    // 2. AGENTS.md
    const agentsMd = this.readFile(join(projectRoot, "AGENTS.md"));
    if (agentsMd && !legacyContent) {
      resources.push(
        this.makeResource(
          "instruction",
          "agents-instructions",
          agentsMd,
          "AGENTS.md",
        ),
      );
    }

    // 3. .cursor/rules/*.mdc and *.md
    const rulesDir = join(projectRoot, ".cursor", "rules");
    for (const file of this.listDir(rulesDir)) {
      if (!file.endsWith(".mdc") && !file.endsWith(".md")) continue;
      const raw = this.readFile(join(rulesDir, file));
      if (!raw) continue;

      const parsed = this.tryParseFrontmatter(raw);
      if (!parsed) continue;

      const { data, content } = parsed;
      const name = file.replace(/\.(mdc|md)$/, "");
      const alwaysApply = data["alwaysApply"] === true;
      const globs = data["globs"]
        ? typeof data["globs"] === "string"
          ? (data["globs"] as string).split(",").map((s: string) => s.trim())
          : (data["globs"] as string[])
        : [];

      // Determine if this is an instruction or a rule
      if (alwaysApply && globs.length === 0) {
        resources.push(
          this.makeResource(
            "instruction",
            name,
            content.trim(),
            `.cursor/rules/${file}`,
            {},
            (data["description"] as string) || "",
          ),
        );
      } else {
        const metadata: RuleMetadata = { globs, always_apply: alwaysApply };
        resources.push(
          this.makeResource(
            "rule",
            name,
            content.trim(),
            `.cursor/rules/${file}`,
            metadata,
            (data["description"] as string) || "",
          ),
        );
      }
    }

    // 4. Skills
    resources.push(...this.scanSkillsDir(projectRoot, ".agents/skills"));

    // 5. Agents: .cursor/agents/*.md
    resources.push(
      ...this.scanAgentFilesAt(
        join(projectRoot, ".cursor", "agents"),
        ".cursor/agents/",
        [".md"],
      ),
    );

    // 6. Hooks: .cursor/hooks.json
    resources.push(
      ...scanHooksFile(
        join(projectRoot, ".cursor", "hooks.json"),
        ".cursor/hooks.json",
      ),
    );

    // 7. MCP servers: .cursor/mcp.json
    resources.push(
      ...this.scanMcpConfig(join(projectRoot, ".cursor", "mcp.json"), ".cursor/mcp.json"),
    );

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const rulesDir = join(homeRoot, ".cursor", "rules");
    for (const file of this.listDir(rulesDir)) {
      if (!file.endsWith(".mdc") && !file.endsWith(".md")) continue;
      const raw = this.readFile(join(rulesDir, file));
      if (!raw) continue;

      const parsed = this.tryParseFrontmatter(raw);
      if (!parsed) continue;

      const { data, content } = parsed;
      const name = file.replace(/\.(mdc|md)$/, "");
      const alwaysApply = data["alwaysApply"] === true;
      const globs = data["globs"]
        ? typeof data["globs"] === "string"
          ? (data["globs"] as string)
              .split(",")
              .map((value: string) => value.trim())
          : (data["globs"] as string[])
        : [];

      if (alwaysApply && globs.length === 0) {
        resources.push(
          this.makeResource(
            "instruction",
            name,
            content.trim(),
            `~/.cursor/rules/${file}`,
            {},
            (data["description"] as string) || "",
          ),
        );
      } else {
        const metadata: RuleMetadata = { globs, always_apply: alwaysApply };
        resources.push(
          this.makeResource(
            "rule",
            name,
            content.trim(),
            `~/.cursor/rules/${file}`,
            metadata,
            (data["description"] as string) || "",
          ),
        );
      }
    }

    resources.push(
      ...this.scanSkillsDirAt(
        join(homeRoot, ".cursor", "skills"),
        "~/.cursor/skills",
      ),
    );

    resources.push(
      ...this.scanAgentFilesAt(
        join(homeRoot, ".cursor", "agents"),
        "~/.cursor/agents/",
        [".md"],
      ),
    );

    if (this.platform.globalPaths.settings) {
      resources.push(
        ...this.scanMcpConfig(
          this.resolveHomePath(homeRoot, this.platform.globalPaths.settings),
          this.platform.globalPaths.settings,
        ),
      );
    }

    return resources;
  }

  private scanMcpConfig(
    configPath: string,
    displayPath: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    const configContent = this.readFile(configPath);
    if (!configContent) {
      return resources;
    }

    try {
      const document = JSON.parse(configContent) as unknown;
      for (const [name, metadata] of Object.entries(parseMcpServersDocument(document))) {
        resources.push(this.makeResource("mcp_server", name, "", displayPath, metadata));
      }
    } catch {
      // invalid JSON — skip
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
    const skillCursorMode = options.skillCursorMode ?? "agent-requested";
    const targetPaths = this.getTargetPaths(target);
    const rulesPath = this.toTargetRelativePath(targetPaths.rules, target);
    const skillsPath = this.toTargetRelativePath(targetPaths.skills, target);
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);
    const hooksPath = this.toTargetRelativePath(targetPaths.hooks, target);
    const mcpPath = this.toTargetRelativePath(
      target === "global" ? targetPaths.settings : targetPaths.mcp,
      target,
    );

    for (const r of resources) {
      switch (r.type) {
        case "instruction": {
          if (!rulesPath) break;
          // Emit as always-apply .mdc rule
          const fm: Record<string, unknown> = {
            description: r.description || r.name,
            alwaysApply: true,
          };
          files.push({
            path: join(rulesPath, `${r.name}.mdc`),
            content: this.emitFrontmatter(fm, r.content),
          });
          break;
        }
        case "rule": {
          if (!rulesPath) break;
          const meta = r.metadata as RuleMetadata;
          const fm: Record<string, unknown> = {
            description: r.description || r.name,
            alwaysApply: meta.always_apply,
          };
          if (meta.globs.length > 0) {
            fm["globs"] = meta.globs.join(",");
          }
          files.push({
            path: join(rulesPath, `${r.name}.mdc`),
            content: this.emitFrontmatter(fm, r.content),
          });
          break;
        }
        case "skill": {
          if ((target === "global" || skillCursorMode === "agents-skills") && skillsPath) {
            files.push(
              ...this.emitSkillWithAuxiliary(
                r,
                join(skillsPath, r.name, "SKILL.md"),
                options,
              ),
            );
            break;
          }
          if (!rulesPath) break;
          const alwaysApply = skillCursorMode === "always-on";
          const fm: Record<string, unknown> = {
            description: r.description || `Skill: ${r.name}`,
            alwaysApply,
          };
          files.push({
            path: join(rulesPath, `${r.name}.mdc`),
            content: this.emitFrontmatter(fm, r.content),
          });
          break;
        }
        case "agent": {
          if (!agentsPath) break;
          files.push({
            path: join(agentsPath, `${r.name}.md`),
            content: emitMarkdownAgent(
              canonicalAgentFromResource({
                name: r.name,
                description: r.description,
                content: r.content,
                metadata: r.metadata as AgentMetadata,
              }),
              "cursor",
            ),
          });
          break;
        }
        case "hook":
          break;
        default:
          break;
      }
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
            { version: 1 },
          ),
          null,
          2,
        ),
      });
    }

    const mcps = this.mcpServersForTarget(resources, mcpPath);
    if (mcps.length > 0 && mcpPath) {
      const mcpServers: Record<string, Record<string, unknown>> = {};
      for (const resource of mcps) {
        mcpServers[resource.name] = emitCursorMcpServerEntry(
          resource.metadata as McpServerMetadata,
        );
      }
      files.push({
        path: mcpPath,
        content: JSON.stringify({ mcpServers }, null, 2),
      });
    }

    return files;
  }
}
