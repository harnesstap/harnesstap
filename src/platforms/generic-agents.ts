import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type { PlatformDefinition, Resource, SerializedFile } from "../types.js";

function resolveGlobalPath(homeRoot: string, configuredPath: string): string {
  return configuredPath.startsWith("~/")
    ? join(homeRoot, configuredPath.slice(2))
    : configuredPath;
}

/**
 * Generic serializer for platforms that follow the .agents/skills/ convention
 * and use AGENTS.md for instructions (Warp, OpenCode, GitHub Copilot, Windsurf, etc.)
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

  async scan(projectRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

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

    return resources as Resource[];
  }

  async scanGlobal(homeRoot: string): Promise<Resource[]> {
    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

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

    return resources as Resource[];
  }

  async serialize(
    resources: Resource[],
    _projectRoot: string,
  ): Promise<SerializedFile[]> {
    const files: SerializedFile[] = [];
    const skillsPath = this.platform.projectPaths.skills ?? ".agents/skills/";
    const instructionPath =
      this.platform.projectPaths.instructions ?? "AGENTS.md";

    // Instructions
    const instructions = resources.filter((r) => r.type === "instruction");
    // Also include rules as instruction sections for platforms without native rules
    const rules = resources.filter((r) => r.type === "rule");

    if (instructions.length > 0 || rules.length > 0) {
      const parts: string[] = [];
      for (const r of instructions) parts.push(r.content);
      for (const r of rules) parts.push(`## ${r.name}\n\n${r.content}`);
      files.push({ path: instructionPath, content: parts.join("\n\n") });
    }

    // Skills
    for (const r of resources.filter((r) => r.type === "skill")) {
      const fm: Record<string, unknown> = {
        name: r.name,
        description: r.description,
      };
      files.push({
        path: `${skillsPath}${r.name}/SKILL.md`,
        content: this.emitFrontmatter(fm, r.content),
      });
    }

    return files;
  }
}
