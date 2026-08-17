import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import type {
  HookMetadata,
  PlatformDefinition,
  Resource,
  ResourceCreateInput,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

const PROJECT_INSTRUCTION_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "AGENTS.local.md",
  "CLAUDE.local.md",
] as const;

function instructionResourceName(path: string): string {
  if (path.endsWith(".local.md")) {
    return `${path.slice(0, -".md".length)}-instructions`;
  }
  return "deepseek-harness-instructions";
}

function hooksOutputPath(hooksPath: string): string {
  if (hooksPath.endsWith("/")) {
    return `${hooksPath}harnesstap.json`;
  }
  return hooksPath;
}

/**
 * Native serializer for DeepSeek Harness (`.dsh/` layout).
 * Project scan/apply only; global scan/serialize is stubbed for a later task.
 */
export class DeepSeekHarnessSerializer extends BaseSerializer {
  readonly platformId = "deepseek-harness";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const platform = getPlatform("deepseek-harness");
    if (!platform) throw new Error("deepseek-harness platform not found in registry");
    this.platform = platform;
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

  private appendSkillsFrom(
    projectRoot: string,
    skillsDir: string,
    resources: ResourceCreateInput[],
    seenSkillNames: Set<string>,
  ): void {
    for (const resource of this.scanSkillsDir(projectRoot, skillsDir)) {
      if (resource.type !== "skill") continue;
      if (seenSkillNames.has(resource.name)) continue;
      seenSkillNames.add(resource.name);
      resources.push(resource);
    }
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];
    const seenSkillNames = new Set<string>();

    const seenInstructionContent = new Set<string>();
    for (const candidate of PROJECT_INSTRUCTION_CANDIDATES) {
      const content = this.readFile(join(projectRoot, candidate));
      if (!content) continue;
      const trimmed = content.trim();
      if (trimmed.length === 0 || seenInstructionContent.has(trimmed)) continue;
      seenInstructionContent.add(trimmed);
      resources.push(
        this.makeResource(
          "instruction",
          instructionResourceName(candidate),
          content,
          candidate,
        ),
      );
    }

    const skillsPath = this.platform.projectPaths.skills ?? ".dsh/skills/";
    this.appendSkillsFrom(projectRoot, skillsPath, resources, seenSkillNames);
    for (const alternate of this.platform.projectPaths.pathAlternates?.skills ?? []) {
      this.appendSkillsFrom(projectRoot, alternate, resources, seenSkillNames);
    }

    const hooksPath = this.platform.projectPaths.hooks ?? ".dsh/hooks/";
    resources.push(
      ...this.scanHooksDir(join(projectRoot, hooksPath), hooksPath),
    );

    return resources;
  }

  async scanGlobal(_homeRoot: string): Promise<ResourceCreateInput[]> {
    return [];
  }

  async serialize(
    resources: Resource[],
    _projectRoot: string,
    options: SerializeOptions = {},
  ): Promise<SerializedFile[]> {
    const target = options.target ?? "project";
    if (target === "global") return [];

    const files: SerializedFile[] = [];
    const targetPaths = this.getTargetPaths(target);
    const instructionsPath =
      this.toTargetRelativePath(targetPaths.instructions, target) ?? "AGENTS.md";
    const skillsPath =
      this.toTargetRelativePath(targetPaths.skills, target) ?? ".dsh/skills/";
    const hooksPath =
      this.toTargetRelativePath(targetPaths.hooks, target) ?? ".dsh/hooks/";

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
