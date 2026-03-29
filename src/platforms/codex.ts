import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type {
  PlatformDefinition,
  Resource,
  SerializedFile,
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

  async scan(projectRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

    // 1. AGENTS.md
    const agentsMd = this.readFile(join(projectRoot, "AGENTS.md"));
    if (agentsMd) {
      resources.push(
        this.makeResource("instruction", "codex-instructions", agentsMd, "AGENTS.md"),
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

    return resources as Resource[];
  }

  async serialize(
    resources: Resource[],
    _projectRoot: string,
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];

    // Instructions → AGENTS.md
    const instructions = resources.filter((r) => r.type === "instruction");
    if (instructions.length > 0) {
      files.push({
        path: "AGENTS.md",
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    // Skills → .agents/skills/{name}/SKILL.md
    for (const r of resources.filter((r) => r.type === "skill")) {
      const fm: Record<string, unknown> = {
        name: r.name,
        description: r.description,
      };
      files.push({
        path: `.agents/skills/${r.name}/SKILL.md`,
        content: this.emitFrontmatter(fm, r.content),
      });
    }

    // Agents → .codex/agents/{name}.toml
    for (const r of resources.filter((r) => r.type === "agent")) {
      files.push({
        path: `.codex/agents/${r.name}.toml`,
        content: r.content,
      });
    }

    // Rules → append to AGENTS.md (Codex doesn't have a native rules system)
    const rules = resources.filter((r) => r.type === "rule");
    if (rules.length > 0 && instructions.length > 0) {
      // Append rules as sections to AGENTS.md
      const rulesSections = rules
        .map((r) => `## ${r.name}\n\n${r.content}`)
        .join("\n\n");
      const existing = files.find((f) => f.path === "AGENTS.md");
      if (existing) {
        existing.content += `\n\n${rulesSections}`;
      }
    } else if (rules.length > 0) {
      files.push({
        path: "AGENTS.md",
        content: rules.map((r) => `## ${r.name}\n\n${r.content}`).join("\n\n"),
      });
    }

    return files;
  }
}
