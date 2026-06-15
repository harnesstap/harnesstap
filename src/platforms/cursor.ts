import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import type {
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
            const fm: Record<string, unknown> = {
              name: r.name,
              description: r.description,
            };
            files.push({
              path: join(skillsPath, r.name, "SKILL.md"),
              content: this.emitFrontmatter(fm, r.content),
            });
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
        // mcp_server, permission, hook, agent, command — not supported in Cursor
        default:
          break;
      }
    }

    return files;
  }
}
