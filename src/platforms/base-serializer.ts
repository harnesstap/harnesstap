import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import matter from "gray-matter";
import { normalizeAgentInput } from "../services/agent-bridge.js";
import { emitSkillAuxiliaryFiles, listSkillAuxiliaryFiles } from "../services/skill-auxiliary.js";
import { scanSkillCommandMetadataResources } from "../services/skill-command-metadata.js";
import { filterMcpServersForTargetPath } from "../services/mcp-target.js";
import type {
  PlatformSerializer,
  Resource,
  ResourceCreateInput,
  ResourceMetadata,
  SerializedFile,
  PlatformDefinition,
  ResourceType,
  PlatformPaths,
  SerializerTarget,
  SerializeOptions,
  SkillMetadata,
} from "../types.js";

/**
 * Base class for platform serializers.
 * Provides common filesystem helpers — subclasses implement scan() and serialize().
 */
export abstract class BaseSerializer implements PlatformSerializer {
  abstract readonly platformId: string;
  abstract readonly platform: PlatformDefinition;

  abstract scan(projectRoot: string): Promise<ResourceCreateInput[]>;
  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    return this.scan(homeRoot);
  }

  abstract serialize(
    resources: Resource[],
    projectRoot: string,
    options?: SerializeOptions,
  ): Promise<SerializedFile[]>;

  // ── Filesystem helpers ──────────────────────────────────────────────

  protected readFile(filePath: string): string | undefined {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return undefined;
    }
  }

  protected fileExists(filePath: string): boolean {
    return existsSync(filePath);
  }

  protected listDir(dirPath: string): string[] {
    try {
      return readdirSync(dirPath);
    } catch {
      return [];
    }
  }

  protected isDirectory(filePath: string): boolean {
    try {
      return statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  }

  protected relativePath(projectRoot: string, filePath: string): string {
    return relative(projectRoot, filePath);
  }

  protected resolveHomePath(homeRoot: string, configuredPath: string): string {
    return configuredPath.startsWith("~/")
      ? join(homeRoot, configuredPath.slice(2))
      : join(homeRoot, configuredPath);
  }

  protected getTargetPaths(target: SerializerTarget = "project"): PlatformPaths {
    return target === "global" ? this.platform.globalPaths : this.platform.projectPaths;
  }

  /** MCP servers that belong on this harness MCP path (path-matched + portable). */
  protected mcpServersForTarget(
    resources: Resource[],
    targetMcpPath: string | undefined,
  ): Resource[] {
    return filterMcpServersForTargetPath(resources, targetMcpPath);
  }

  protected toTargetRelativePath(
    configuredPath: string | undefined,
    target: SerializerTarget = "project",
  ): string | undefined {
    if (!configuredPath) return undefined;
    if (target === "global" && configuredPath.startsWith("~/")) {
      return configuredPath.slice(2);
    }
    return configuredPath;
  }

  protected prefixedRelativePath(
    rootPath: string,
    filePath: string,
    prefix: string,
  ): string {
    const relativePath = relative(rootPath, filePath).split(sep).join("/");
    const normalizedPrefix = prefix.replace(/\/$/, "");

    if (!relativePath) return normalizedPrefix;
    return `${normalizedPrefix}/${relativePath}`;
  }

  // ── Frontmatter helpers ─────────────────────────────────────────────

  protected parseFrontmatter(content: string): {
    data: Record<string, unknown>;
    content: string;
  } {
    const parsed = matter(content);
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content,
    };
  }

  protected tryParseFrontmatter(content: string):
    | {
        data: Record<string, unknown>;
        content: string;
      }
    | undefined {
    try {
      const parsed = this.parseFrontmatter(content);

      // gray-matter can return the original content unchanged when a file starts
      // with malformed frontmatter. Treat that as an invalid parse so scanners
      // skip the broken resource instead of importing raw frontmatter text.
      if (content.startsWith("---") && parsed.content === content) {
        return undefined;
      }

      return parsed;
    } catch {
      return undefined;
    }
  }

  protected emitFrontmatter(
    data: Record<string, unknown>,
    content: string,
  ): string {
    // Only emit frontmatter if there are non-empty fields
    const nonEmpty = Object.entries(data).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (nonEmpty.length === 0) return content;
    return matter.stringify(content, Object.fromEntries(nonEmpty));
  }

  // ── Resource builder helpers ────────────────────────────────────────

  protected makeResource(
    type: ResourceType,
    name: string,
    content: string,
    source: string,
    metadata: ResourceMetadata = {},
    description = "",
  ): ResourceCreateInput {
    return { type, name, description, content, metadata, source };
  }

  protected scanAgentFilesAt(
    fullPath: string,
    displayPath: string,
    extensions: string[],
  ): ResourceCreateInput[] {
    const resources: ResourceCreateInput[] = [];
    if (!displayPath.endsWith("/")) return resources;

    for (const file of this.listDir(fullPath)) {
      if (!extensions.some((ext) => file.endsWith(ext))) continue;
      const raw = this.readFile(join(fullPath, file));
      if (!raw) continue;
      const source = `${displayPath}${file}`;
      const fallbackName = file.replace(/\.(agent\.)?(md|toml)$/, "");
      const normalized = normalizeAgentInput({
        name: fallbackName,
        content: raw,
        source,
      });
      if (normalized) {
        resources.push(
          this.makeResource(
            "agent",
            normalized.name,
            normalized.content,
            source,
            normalized.metadata,
            normalized.description,
          ),
        );
        continue;
      }
      resources.push(this.makeResource("agent", fallbackName, raw, source));
    }

    return resources;
  }

  protected scanSkillsDir(
    projectRoot: string,
    skillsDir: string,
  ): ResourceCreateInput[] {
    const fullPath = join(projectRoot, skillsDir);
    const sourcePrefix = skillsDir.replace(/\/$/, "");
    const resources = this.scanSkillsDirAt(fullPath, sourcePrefix);

    if (!this.isDirectory(fullPath)) {
      return resources;
    }

    for (const entry of this.listDir(fullPath)) {
      const entryPath = join(fullPath, entry);
      const skillMd = join(entryPath, "SKILL.md");
      if (!this.isDirectory(entryPath) || !this.fileExists(skillMd)) continue;

      const raw = this.readFile(skillMd);
      if (!raw) continue;

      const parsed = this.tryParseFrontmatter(raw);
      if (!parsed) continue;

      const skillName = (parsed.data["name"] as string) || entry;
      resources.push(
        ...scanSkillCommandMetadataResources({
          skillDir: entryPath,
          skillName,
          rootPath: projectRoot,
          relativePath: (rootPath, filePath) =>
            relative(rootPath, filePath).split(sep).join("/"),
        }),
      );
    }

    return resources;
  }

  protected scanSkillsDirAt(
    fullPath: string,
    sourcePrefix: string,
  ): ResourceCreateInput[] {
    if (!this.isDirectory(fullPath)) return [];

    const resources: ResourceCreateInput[] = [];

    for (const entry of this.listDir(fullPath)) {
      const entryPath = join(fullPath, entry);
      const skillMd = join(entryPath, "SKILL.md");

      if (this.isDirectory(entryPath) && this.fileExists(skillMd)) {
        const raw = this.readFile(skillMd);
        if (!raw) continue;

        const parsed = this.tryParseFrontmatter(raw);
        if (!parsed) continue;

        const { data, content } = parsed;
        const { scripts, references } = listSkillAuxiliaryFiles(entryPath);
        resources.push(
          this.makeResource(
            "skill",
            (data["name"] as string) || entry,
            content.trim(),
            this.prefixedRelativePath(fullPath, skillMd, sourcePrefix),
            {
              scripts,
              references,
            },
            (data["description"] as string) || "",
          ),
        );
      }
    }

    return resources;
  }

  protected resolveSkillSourceDir(
    resource: Resource,
    sourceRoot: string,
  ): string | undefined {
    const dir = dirname(join(sourceRoot, resource.source));
    return existsSync(dir) ? dir : undefined;
  }

  protected emitSkillWithAuxiliary(
    resource: Resource,
    skillMdPath: string,
    options: SerializeOptions,
  ): SerializedFile[] {
    const fm: Record<string, unknown> = {
      name: resource.name,
      description: resource.description,
    };
    const files: SerializedFile[] = [
      {
        path: skillMdPath,
        content: this.emitFrontmatter(fm, resource.content),
      },
    ];

    const meta = resource.metadata as SkillMetadata;
    if (
      !options.skillSourceRoot ||
      (!meta.scripts?.length && !meta.references?.length)
    ) {
      return files;
    }

    const sourceSkillDir = this.resolveSkillSourceDir(
      resource,
      options.skillSourceRoot,
    );
    if (!sourceSkillDir) return files;

    const targetPrefix = skillMdPath.replace(/\/SKILL\.md$/, "");
    files.push(
      ...emitSkillAuxiliaryFiles({
        sourceSkillDir,
        targetPrefix,
        scripts: meta.scripts ?? [],
        references: meta.references ?? [],
      }),
    );
    return files;
  }
}
