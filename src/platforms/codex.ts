import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type {
  PlatformDefinition,
  ResourceCreateInput,
  Resource,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

export class CodexSerializer extends BaseSerializer {
  readonly platformId = "codex";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const p = getPlatform("codex");
    if (!p) throw new Error("codex platform not found in registry");
    this.platform = p;
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
    const agentsDir = join(projectRoot, ".codex", "agents");
    for (const file of this.listDir(agentsDir)) {
      if (!file.endsWith(".toml")) continue;
      const content = this.readFile(join(agentsDir, file));
      if (!content) continue;
      const name = file.replace(/\.toml$/, "");
      resources.push(
        this.makeResource("agent", name, content, `.codex/agents/${file}`),
      );
    }

    // TODO: Parse .codex/config.toml for MCP servers, permissions, model config

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

    const agentsDir = join(homeRoot, ".codex", "agents");
    for (const file of this.listDir(agentsDir)) {
      if (!file.endsWith(".toml")) continue;
      const content = this.readFile(join(agentsDir, file));
      if (!content) continue;
      const name = file.replace(/\.toml$/, "");
      resources.push(
        this.makeResource("agent", name, content, `~/.codex/agents/${file}`),
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
    const instructionsPath =
      this.toTargetRelativePath(targetPaths.instructions, target) ??
      (target === "project" ? "AGENTS.md" : undefined);
    const skillsPath =
      this.toTargetRelativePath(targetPaths.skills, target) ??
      (target === "project" ? ".agents/skills/" : undefined);
    const agentsPath = this.toTargetRelativePath(targetPaths.agents, target);

    // Instructions → AGENTS.md
    const instructions = resources.filter((r) => r.type === "instruction");
    if (instructions.length > 0 && instructionsPath) {
      files.push({
        path: instructionsPath,
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    // Skills → .agents/skills/{name}/SKILL.md
    for (const r of resources.filter((r) => r.type === "skill")) {
      if (!skillsPath) continue;
      const fm: Record<string, unknown> = {
        name: r.name,
        description: r.description,
      };
      files.push({
        path: `${skillsPath}${r.name}/SKILL.md`,
        content: this.emitFrontmatter(fm, r.content),
      });
    }

    // Agents → .codex/agents/{name}.toml
    for (const r of resources.filter((r) => r.type === "agent")) {
      if (!agentsPath) continue;
      files.push({
        path: `${agentsPath}${r.name}.toml`,
        content: r.content,
      });
    }

    // Rules → append to AGENTS.md (Codex doesn't have a native rules system)
    const rules = resources.filter((r) => r.type === "rule");
    if (rules.length > 0 && instructions.length > 0 && instructionsPath) {
      // Append rules as sections to AGENTS.md
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

    return files;
  }
}
