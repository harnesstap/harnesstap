import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import matter from "gray-matter";
import type {
  PlatformSerializer,
  Resource,
  ResourceMetadata,
  SerializedFile,
  PlatformDefinition,
  ResourceType,
} from "../types.js";

/**
 * Base class for platform serializers.
 * Provides common filesystem helpers — subclasses implement scan() and serialize().
 */
export abstract class BaseSerializer implements PlatformSerializer {
  abstract readonly platformId: string;
  abstract readonly platform: PlatformDefinition;

  abstract scan(projectRoot: string): Promise<Resource[]>;
  async scanGlobal(homeRoot: string): Promise<Resource[]> {
    return this.scan(homeRoot);
  }

  abstract serialize(
    resources: Resource[],
    projectRoot: string,
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
  ): Omit<Resource, "id" | "created_at" | "updated_at"> {
    return { type, name, description, content, metadata, source };
  }

  protected scanSkillsDir(
    projectRoot: string,
    skillsDir: string,
  ): Omit<Resource, "id" | "created_at" | "updated_at">[] {
    const fullPath = join(projectRoot, skillsDir);
    return this.scanSkillsDirAt(fullPath, skillsDir.replace(/\/$/, ""));
  }

  protected scanSkillsDirAt(
    fullPath: string,
    sourcePrefix: string,
  ): Omit<Resource, "id" | "created_at" | "updated_at">[] {
    if (!this.isDirectory(fullPath)) return [];

    const resources: Omit<Resource, "id" | "created_at" | "updated_at">[] = [];

    for (const entry of this.listDir(fullPath)) {
      const entryPath = join(fullPath, entry);
      const skillMd = join(entryPath, "SKILL.md");

      if (this.isDirectory(entryPath) && this.fileExists(skillMd)) {
        const raw = this.readFile(skillMd);
        if (!raw) continue;

        const parsed = this.tryParseFrontmatter(raw);
        if (!parsed) continue;

        const { data, content } = parsed;
        resources.push(
          this.makeResource(
            "skill",
            (data["name"] as string) || entry,
            content.trim(),
            this.prefixedRelativePath(fullPath, skillMd, sourcePrefix),
            {
              scripts: [],
              references: [],
            },
            (data["description"] as string) || "",
          ),
        );
      }
    }

    return resources;
  }
}
