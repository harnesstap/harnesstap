import { join, relative, sep } from "node:path";
import { parse, stringify } from "yaml";
import { BaseSerializer } from "./base-serializer.js";
import {
  hooksBridgeInsertItem,
  mergeCordisPatch,
  mergeSettingsYaml,
  mcpResourceToInsertItem,
  parseCordisMcpServers,
  parseSettingsResources,
  resolveDshHome,
  sanitizePresetId,
  type CordisInsertItem,
  type SettingsOverlay,
} from "./deepseek-harness-home.js";
import { getPlatform } from "./registry.js";
import { buildHooksJson, scanHooksFile } from "../services/hook-serialization.js";
import type {
  HookMetadata,
  McpServerMetadata,
  ModelConfigMetadata,
  PermissionMetadata,
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

const PERSONA_PLUGIN_NAME = "@deepseek-ai/dsh-persona";
const LEGAL_PERMISSION_PRESETS = new Set(["workspace-write", "danger-full-access"]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function personaTextFromCordis(content: string): string | undefined {
  try {
    const parsed: unknown = parse(content);
    if (!Array.isArray(parsed)) return undefined;
    for (const item of parsed) {
      if (!isRecord(item) || item.name !== PERSONA_PLUGIN_NAME) continue;
      if (!isRecord(item.config) || typeof item.config.text !== "string") continue;
      return item.config.text;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function presetDescription(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed: unknown = parse(content);
    if (isRecord(parsed) && typeof parsed.description === "string") {
      return parsed.description;
    }
  } catch {
    return "";
  }
  return "";
}

function dshRelative(projectRoot: string, dshHome: string, subpath: string): string {
  return relative(projectRoot, join(dshHome, subpath)).split(sep).join("/");
}

/**
 * Native serializer for DeepSeek Harness (`.dsh/` layout).
 * Project scan/apply writes portable files; global scan/apply owns `$DSH_HOME`.
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

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];
    const dshHome = resolveDshHome(homeRoot);

    const instructions = this.readFile(join(dshHome, "AGENTS.md"));
    if (instructions && instructions.trim().length > 0) {
      resources.push(
        this.makeResource(
          "instruction",
          "deepseek-harness-instructions",
          instructions,
          "~/.dsh/AGENTS.md",
        ),
      );
    }

    for (const resource of this.scanSkillsDirAt(join(dshHome, "skills"), "~/.dsh/skills")) {
      if (resource.type !== "skill") continue;
      resources.push(resource);
    }

    const patchContent = this.readFile(join(dshHome, "cordis.patch.yml"));
    if (patchContent) {
      resources.push(...parseCordisMcpServers(patchContent, "~/.dsh/cordis.patch.yml"));
    }

    resources.push(...this.scanHooksDir(join(dshHome, "hooks"), "~/.dsh/hooks/"));

    const settingsContent = this.readFile(join(dshHome, "settings.yaml"));
    if (settingsContent) {
      resources.push(...parseSettingsResources(settingsContent, "~/.dsh/settings.yaml"));
    }

    const presetsRoot = join(dshHome, ".agent-presets");
    for (const entry of this.listDir(presetsRoot)) {
      const presetDir = join(presetsRoot, entry);
      if (!this.isDirectory(presetDir)) continue;
      const description = presetDescription(this.readFile(join(presetDir, "preset.yml")));
      const cordisYml = this.readFile(join(presetDir, "agent.cordis.yml"));
      const personaText = cordisYml ? personaTextFromCordis(cordisYml) : undefined;
      resources.push(
        this.makeResource(
          "agent",
          entry,
          personaText ?? description,
          `~/.dsh/.agent-presets/${entry}`,
          {},
          description,
        ),
      );
    }

    return resources;
  }

  async serialize(
    resources: Resource[],
    projectRoot: string,
    options: SerializeOptions = {},
  ): Promise<SerializedFile[]> {
    const target = options.target ?? "project";
    if (target === "global") {
      return this.serializeGlobal(resources, projectRoot, options);
    }

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

  private serializeGlobal(
    resources: Resource[],
    projectRoot: string,
    options: SerializeOptions,
  ): SerializedFile[] {
    const dshHome = resolveDshHome(projectRoot);
    const rel = (subpath: string) => dshRelative(projectRoot, dshHome, subpath);

    const mcpServers = this.mcpServersForTarget(
      resources,
      this.platform.globalPaths.mcp,
    );
    const hooks = resources.filter((r) => r.type === "hook");
    const rows: CordisInsertItem[] = [];
    for (const server of mcpServers) {
      const item = mcpResourceToInsertItem(
        server.name,
        server.metadata as McpServerMetadata,
      );
      if (item) rows.push(item);
    }
    if (hooks.length > 0) {
      rows.push(hooksBridgeInsertItem(join(dshHome, "hooks/harnesstap.json")));
    }

    let patchYaml: string | undefined;
    if (rows.length > 0) {
      patchYaml = mergeCordisPatch(
        this.readFile(join(dshHome, "cordis.patch.yml")),
        rows,
      );
    }

    const modelConfig = resources.find((r) => r.type === "model_config");
    const permissionPreset = resources
      .filter((r) => r.type === "permission")
      .map((r) => (r.metadata as PermissionMetadata).pattern)
      .find((pattern) => LEGAL_PERMISSION_PRESETS.has(pattern));

    let settingsYaml: string | undefined;
    if (modelConfig || permissionPreset) {
      const overlay: SettingsOverlay = {};
      if (modelConfig) {
        const meta = modelConfig.metadata as ModelConfigMetadata;
        overlay.model = { model: meta.model, provider: meta.provider };
      }
      if (permissionPreset) overlay.permissionPreset = permissionPreset;
      settingsYaml = mergeSettingsYaml(
        this.readFile(join(dshHome, "settings.yaml")),
        overlay,
      );
    }

    const files: SerializedFile[] = [];

    const instructions = resources.filter((r) => r.type === "instruction");
    if (instructions.length > 0) {
      files.push({
        path: rel("AGENTS.md"),
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    for (const r of resources.filter((r) => r.type === "skill")) {
      files.push(
        ...this.emitSkillWithAuxiliary(r, rel(`skills/${r.name}/SKILL.md`), options),
      );
    }

    if (patchYaml !== undefined) {
      files.push({ path: rel("cordis.patch.yml"), content: patchYaml });
    }

    if (hooks.length > 0) {
      files.push({
        path: rel("hooks/harnesstap.json"),
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

    if (settingsYaml !== undefined) {
      files.push({ path: rel("settings.yaml"), content: settingsYaml });
    }

    const agentsById = new Map<string, Resource>();
    for (const r of resources.filter((r) => r.type === "agent")) {
      agentsById.set(sanitizePresetId(r.name), r);
    }
    for (const [id, r] of agentsById) {
      files.push({
        path: rel(`.agent-presets/${id}/preset.yml`),
        content: stringify({
          name: r.description || r.name,
          description: r.description ?? "",
        }),
      });
      files.push({
        path: rel(`.agent-presets/${id}/agent.cordis.yml`),
        content: stringify([
          {
            id: "persona",
            name: PERSONA_PLUGIN_NAME,
            config: { text: r.content, complete: false },
          },
        ]),
      });
    }

    return files;
  }
}
