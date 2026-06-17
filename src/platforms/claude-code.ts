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
  HookMetadata,
  PlatformDefinition,
  ResourceCreateInput,
  Resource,
  SerializedFile,
  RuleMetadata,
  McpServerMetadata,
  PermissionMetadata,
  SerializeOptions,
} from "../types.js";

export class ClaudeCodeSerializer extends BaseSerializer {
  readonly platformId = "claude-code";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const p = getPlatform("claude-code");
    if (!p) throw new Error("claude-code platform not found in registry");
    this.platform = p;
  }

  // ── Scan ────────────────────────────────────────────────────────────

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    // 1. Instructions: CLAUDE.md or .claude/CLAUDE.md
    for (const path of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
      const content = this.readFile(join(projectRoot, path));
      if (content) {
        resources.push(
          this.makeResource(
            "instruction",
            "claude-instructions",
            content,
            path,
          ),
        );
        break; // only take the first found
      }
    }

    // 2. Rules: .claude/rules/*.md
    const rulesDir = join(projectRoot, ".claude", "rules");
    for (const file of this.listDir(rulesDir)) {
      if (!file.endsWith(".md")) continue;
      const raw = this.readFile(join(rulesDir, file));
      if (!raw) continue;

      const parsed = this.tryParseFrontmatter(raw);
      if (!parsed) continue;

      const { data, content } = parsed;
      const name = file.replace(/\.md$/, "");
      const metadata: RuleMetadata = {
        globs: Array.isArray(data["paths"]) ? (data["paths"] as string[]) : [],
        always_apply:
          !data["paths"] || (data["paths"] as string[]).length === 0,
      };

      resources.push(
        this.makeResource(
          "rule",
          name,
          content.trim(),
          `.claude/rules/${file}`,
          metadata,
        ),
      );
    }

    // 3. Skills: .claude/skills/*/SKILL.md
    resources.push(...this.scanSkillsDir(projectRoot, ".claude/skills"));

    // 4. MCP servers: .mcp.json
    const mcpContent = this.readFile(join(projectRoot, ".mcp.json"));
    if (mcpContent) {
      try {
        const mcpConfig = JSON.parse(mcpContent) as {
          mcpServers?: Record<string, Record<string, unknown>>;
        };
        for (const [name, config] of Object.entries(
          mcpConfig.mcpServers ?? {},
        )) {
          const metadata: McpServerMetadata = {
            transport: config["url"] ? "http" : "stdio",
            command: config["command"] as string | undefined,
            url: config["url"] as string | undefined,
            args: config["args"] as string[] | undefined,
            env: config["env"] as Record<string, string> | undefined,
          };
          resources.push(
            this.makeResource("mcp_server", name, "", ".mcp.json", metadata),
          );
        }
      } catch {
        // invalid JSON — skip
      }
    }

    // 5. Settings: .claude/settings.json (permissions, hooks, env)
    const settingsContent = this.readFile(
      join(projectRoot, ".claude", "settings.json"),
    );
    if (settingsContent) {
      try {
        const settings = JSON.parse(settingsContent) as {
          permissions?: { allow?: string[]; deny?: string[] };
          env?: Record<string, string>;
          hooks?: Record<string, unknown>;
        };

        // Permissions
        for (const pattern of settings.permissions?.allow ?? []) {
          resources.push(
            this.makeResource(
              "permission",
              `allow-${pattern}`,
              "",
              ".claude/settings.json",
              { action: "allow", pattern } satisfies PermissionMetadata,
            ),
          );
        }
        for (const pattern of settings.permissions?.deny ?? []) {
          resources.push(
            this.makeResource(
              "permission",
              `deny-${pattern}`,
              "",
              ".claude/settings.json",
              { action: "deny", pattern } satisfies PermissionMetadata,
            ),
          );
        }

        // Env vars
        for (const [key, value] of Object.entries(settings.env ?? {})) {
          resources.push(
            this.makeResource("env_var", key, "", ".claude/settings.json", {
              key,
              value,
            }),
          );
        }

        // Hooks
        resources.push(
          ...scanHooksFile(
            join(projectRoot, ".claude", "settings.json"),
            ".claude/settings.json",
          ),
        );
      } catch {
        // invalid JSON — skip
      }
    }

    // 6. Agents: .claude/agents/*.md
    resources.push(
      ...this.scanAgentFilesAt(
        join(projectRoot, ".claude", "agents"),
        ".claude/agents/",
        [".md"],
      ),
    );

    // 7. Commands: .claude/commands/*.md
    const commandsDir = join(projectRoot, ".claude", "commands");
    for (const file of this.listDir(commandsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = this.readFile(join(commandsDir, file));
      if (!content) continue;
      const name = file.replace(/\.md$/, "");
      resources.push(
        this.makeResource("command", name, content, `.claude/commands/${file}`),
      );
    }

    // Cast through the model layer (add ids + timestamps on import)
    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const instructionsPath = join(homeRoot, ".claude", "CLAUDE.md");
    const instructionsContent = this.readFile(instructionsPath);
    if (instructionsContent) {
      resources.push(
        this.makeResource(
          "instruction",
          "claude-instructions",
          instructionsContent,
          "~/.claude/CLAUDE.md",
        ),
      );
    }

    const rulesDir = join(homeRoot, ".claude", "rules");
    for (const file of this.listDir(rulesDir)) {
      if (!file.endsWith(".md")) continue;
      const raw = this.readFile(join(rulesDir, file));
      if (!raw) continue;

      const parsed = this.tryParseFrontmatter(raw);
      if (!parsed) continue;

      const { data, content } = parsed;
      const name = file.replace(/\.md$/, "");
      const metadata: RuleMetadata = {
        globs: Array.isArray(data["paths"]) ? (data["paths"] as string[]) : [],
        always_apply:
          !data["paths"] || (data["paths"] as string[]).length === 0,
      };

      resources.push(
        this.makeResource(
          "rule",
          name,
          content.trim(),
          `~/.claude/rules/${file}`,
          metadata,
        ),
      );
    }

    resources.push(
      ...this.scanSkillsDirAt(
        join(homeRoot, ".claude", "skills"),
        "~/.claude/skills",
      ),
    );

    const settingsContent = this.readFile(
      join(homeRoot, ".claude", "settings.json"),
    );
    if (settingsContent) {
      try {
        const settings = JSON.parse(settingsContent) as {
          permissions?: { allow?: string[]; deny?: string[] };
          env?: Record<string, string>;
        };

        for (const pattern of settings.permissions?.allow ?? []) {
          resources.push(
            this.makeResource(
              "permission",
              `allow-${pattern}`,
              "",
              "~/.claude/settings.json",
              { action: "allow", pattern } satisfies PermissionMetadata,
            ),
          );
        }
        for (const pattern of settings.permissions?.deny ?? []) {
          resources.push(
            this.makeResource(
              "permission",
              `deny-${pattern}`,
              "",
              "~/.claude/settings.json",
              { action: "deny", pattern } satisfies PermissionMetadata,
            ),
          );
        }

        for (const [key, value] of Object.entries(settings.env ?? {})) {
          resources.push(
            this.makeResource("env_var", key, "", "~/.claude/settings.json", {
              key,
              value,
            }),
          );
        }
      } catch {
        // invalid JSON — skip
      }
    }

    resources.push(
      ...this.scanAgentFilesAt(
        join(homeRoot, ".claude", "agents"),
        "~/.claude/agents/",
        [".md"],
      ),
    );

    const commandsDir = join(homeRoot, ".claude", "commands");
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
          `~/.claude/commands/${file}`,
        ),
      );
    }

    return resources;
  }

  // ── Serialize ───────────────────────────────────────────────────────

  async serialize(
    resources: Resource[],
    _projectRoot: string,
    options: SerializeOptions = {},
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];
    const target = options.target ?? "project";
    const targetPaths = this.getTargetPaths(target);
    const instructionsPath =
      this.toTargetRelativePath(targetPaths.instructions, target) ??
      (target === "project" ? "CLAUDE.md" : undefined);
    const rulesPath = this.toTargetRelativePath(targetPaths.rules, target);
    const skillsPath = this.toTargetRelativePath(targetPaths.skills, target);
    const mcpPath = this.toTargetRelativePath(targetPaths.mcp, target);
    const settingsPath = this.toTargetRelativePath(targetPaths.settings, target);
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);
    const commandsPath = this.toTargetRelativePath(targetPaths.commands, target);

    // Group resources by type
    const byType = new Map<string, Resource[]>();
    for (const r of resources) {
      const list = byType.get(r.type) ?? [];
      list.push(r);
      byType.set(r.type, list);
    }

    // Instructions → CLAUDE.md
    const instructions = byType.get("instruction") ?? [];
    if (instructions.length > 0 && instructionsPath) {
      const combined = instructions.map((r) => r.content).join("\n\n");
      files.push({ path: instructionsPath, content: combined });
    }

    // Rules → .claude/rules/{name}.md
    for (const r of byType.get("rule") ?? []) {
      if (!rulesPath) continue;
      const meta = r.metadata as RuleMetadata;
      const frontmatter: Record<string, unknown> = {};
      if (meta.globs.length > 0) {
        frontmatter["paths"] = meta.globs;
      }
      const content = this.emitFrontmatter(frontmatter, r.content);
      files.push({ path: `${rulesPath}${r.name}.md`, content });
    }

    // Skills → .claude/skills/{name}/SKILL.md
    for (const r of byType.get("skill") ?? []) {
      if (!skillsPath) continue;
      files.push(
        ...this.emitSkillWithAuxiliary(
          r,
          `${skillsPath}${r.name}/SKILL.md`,
          options,
        ),
      );
    }

    // MCP servers → .mcp.json
    const mcpServers = byType.get("mcp_server") ?? [];
    if (mcpServers.length > 0 && mcpPath) {
      const mcpConfig: Record<string, Record<string, unknown>> = {};
      for (const r of mcpServers) {
        const meta = r.metadata as McpServerMetadata;
        const entry: Record<string, unknown> = {};
        if (meta.transport === "http" && meta.url) {
          entry["type"] = "http";
          entry["url"] = meta.url;
        } else {
          if (meta.command) entry["command"] = meta.command;
          if (meta.args) entry["args"] = meta.args;
        }
        if (meta.env && Object.keys(meta.env).length > 0)
          entry["env"] = meta.env;
        mcpConfig[r.name] = entry;
      }
      files.push({
        path: mcpPath,
        content: JSON.stringify({ mcpServers: mcpConfig }, null, 2),
      });
    }

    // Permissions + env + hooks → .claude/settings.json
    const permissions = byType.get("permission") ?? [];
    const envVars = byType.get("env_var") ?? [];
    const hooks = byType.get("hook") ?? [];
    if (
      (permissions.length > 0 || envVars.length > 0 || hooks.length > 0) &&
      settingsPath
    ) {
      const settings: Record<string, unknown> = {};
      if (permissions.length > 0) {
        const allow: string[] = [];
        const deny: string[] = [];
        for (const r of permissions) {
          const meta = r.metadata as PermissionMetadata;
          if (meta.action === "allow") allow.push(meta.pattern);
          else if (meta.action === "deny") deny.push(meta.pattern);
        }
        if (allow.length > 0 || deny.length > 0) {
          settings["permissions"] = { allow, deny };
        }
      }
      if (envVars.length > 0) {
        const env: Record<string, string> = {};
        for (const r of envVars) {
          const meta = r.metadata as { key: string; value: string };
          env[meta.key] = meta.value;
        }
        settings["env"] = env;
      }
      if (hooks.length > 0) {
        settings["hooks"] = buildHooksJson(
          hooks.map((r) => ({
            ...(r.metadata as HookMetadata),
            name: r.name,
          })),
        ).hooks;
      }
      if (Object.keys(settings).length > 0) {
        files.push({
          path: settingsPath,
          content: JSON.stringify(settings, null, 2),
        });
      }
    }

    // Agents → .claude/agents/{name}.md
    for (const r of byType.get("agent") ?? []) {
      if (!agentsPath) continue;
      const content = r.content.startsWith("---")
        ? r.content
        : emitMarkdownAgent(
            canonicalAgentFromResource({
              name: r.name,
              description: r.description,
              content: r.content,
              metadata: r.metadata as AgentMetadata,
            }),
            "claude",
          );
      files.push({ path: `${agentsPath}${r.name}.md`, content });
    }

    // Commands → .claude/commands/{name}.md
    for (const r of byType.get("command") ?? []) {
      if (!commandsPath) continue;
      files.push({ path: `${commandsPath}${r.name}.md`, content: r.content });
    }

    return files;
  }
}
