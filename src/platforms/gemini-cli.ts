import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type {
  PlatformDefinition,
  ResourceCreateInput,
  Resource,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

interface GeminiExtensionManifest {
  name?: string;
  version?: string;
  description?: string;
  contextFileName?: string;
}

interface GeminiInstructionMetadata {
  contextFileName?: string;
  extension?: GeminiExtensionManifest;
}

interface GeminiCommandMetadata {
  format?: "toml" | "md";
}

export class GeminiCliSerializer extends BaseSerializer {
  readonly platformId = "gemini-cli";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const p = getPlatform("gemini-cli");
    if (!p) throw new Error("gemini-cli platform not found in registry");
    this.platform = p;
  }

  private scanCommandsAt(
    projectRoot: string,
    relativeDir: string,
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    const commandsDir = join(projectRoot, relativeDir);
    const sourcePrefix = relativeDir.endsWith("/")
      ? relativeDir
      : `${relativeDir}/`;

    for (const file of this.listDir(commandsDir)) {
      const commandPath = join(commandsDir, file);
      const name = file.replace(/\.(md|toml)$/, "");
      if (name === file) continue;

      if (file.endsWith(".md")) {
        const content = this.readFile(commandPath);
        if (!content) continue;
        resources.push(
          this.makeResource(
            "command",
            name,
            content.trim(),
            `${sourcePrefix}${file}`,
            { format: "md" } satisfies GeminiCommandMetadata,
          ),
        );
        continue;
      }

      if (!file.endsWith(".toml")) continue;

      const raw = this.readFile(commandPath);
      if (!raw) continue;

      let parsed: { description?: string; prompt?: string };
      try {
        parsed = parseToml(raw) as { description?: string; prompt?: string };
      } catch {
        continue;
      }

      const description =
        typeof parsed.description === "string" ? parsed.description : "";
      const content =
        typeof parsed.prompt === "string" ? parsed.prompt : raw.trim();

      resources.push(
        this.makeResource(
          "command",
          name,
          content,
          `${sourcePrefix}${file}`,
          { format: "toml" } satisfies GeminiCommandMetadata,
          description,
        ),
      );
    }

    return resources;
  }

  private commandOutputPath(
    resource: Resource,
    defaultCommandsPath: string,
  ): string {
    const metadata = resource.metadata as GeminiCommandMetadata;
    const extension = metadata.format === "toml" ? "toml" : "md";

    if (resource.source.includes("commands/")) {
      return `commands/${resource.name}.${extension}`;
    }

    return `${defaultCommandsPath}${resource.name}.${extension}`;
  }

  private emitCommandContent(resource: Resource): string {
    const metadata = resource.metadata as GeminiCommandMetadata;
    if (metadata.format === "toml") {
      const payload: Record<string, string> = {
        prompt: resource.content,
      };
      if (resource.description) {
        payload.description = resource.description;
      }
      return `${stringifyToml(payload)}\n`;
    }

    return resource.content;
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    const manifestPath = join(projectRoot, "gemini-extension.json");
    const manifestContent = this.readFile(manifestPath);
    let manifest: GeminiExtensionManifest | undefined;
    let instructionImported = false;

    if (manifestContent) {
      try {
        manifest = JSON.parse(manifestContent) as GeminiExtensionManifest;
      } catch {
        manifest = undefined;
      }
    }

    if (manifest?.contextFileName) {
      const contextPath = join(projectRoot, manifest.contextFileName);
      const content = this.readFile(contextPath);
      if (content) {
        resources.push(
          this.makeResource(
            "instruction",
            "gemini-instructions",
            content,
            manifest.contextFileName,
            {
              contextFileName: manifest.contextFileName,
              extension: manifest,
            } satisfies GeminiInstructionMetadata,
          ),
        );
        instructionImported = true;
      }
    }

    if (!instructionImported) {
      const agentsMd = this.readFile(join(projectRoot, "AGENTS.md"));
      if (agentsMd) {
        resources.push(
          this.makeResource(
            "instruction",
            "gemini-instructions",
            agentsMd,
            "AGENTS.md",
            manifest
              ? ({
                  contextFileName: "AGENTS.md",
                  extension: manifest,
                } satisfies GeminiInstructionMetadata)
              : {},
          ),
        );
      }
    }

    resources.push(...this.scanSkillsDir(projectRoot, ".agents/skills"));
    resources.push(...this.scanSkillsDir(projectRoot, "skills"));

    resources.push(...this.scanCommandsAt(projectRoot, "commands"));

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    if (this.platform.globalPaths.skills) {
      const skillsDir = this.resolveHomePath(
        homeRoot,
        this.platform.globalPaths.skills,
      );
      resources.push(
        ...this.scanSkillsDirAt(
          skillsDir,
          this.platform.globalPaths.skills.replace(/\/$/, ""),
        ),
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
    const commandsPath = this.toTargetRelativePath(targetPaths.commands, target);

    const instructions = resources.filter((r) => r.type === "instruction");
    const skills = resources.filter((r) => r.type === "skill");
    const commands = resources.filter((r) => r.type === "command");

    if (instructions.length > 0 && instructionsPath) {
      files.push({
        path: instructionsPath,
        content: instructions.map((r) => r.content).join("\n\n"),
      });

      if (target === "project") {
        const firstMeta = instructions[0]?.metadata as GeminiInstructionMetadata;
        const extension = firstMeta.extension ?? {};
        const contextFileName =
          firstMeta.contextFileName ?? instructionsPath;

        const manifest: GeminiExtensionManifest = {
          ...extension,
          contextFileName,
        };

        files.push({
          path: "gemini-extension.json",
          content: `${JSON.stringify(manifest, null, 2)}\n`,
        });
      }
    }

    if (skillsPath) {
      for (const r of skills) {
        const fm: Record<string, unknown> = {
          name: r.name,
          description: r.description,
        };
        files.push({
          path: `${skillsPath}${r.name}/SKILL.md`,
          content: this.emitFrontmatter(fm, r.content),
        });
      }
    }

    if (commandsPath) {
      for (const r of commands) {
        files.push({
          path: this.commandOutputPath(r, commandsPath),
          content: this.emitCommandContent(r),
        });
      }
    }

    return files;
  }
}
