import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { buildHooksJson, parseHooksJsonContent, scanHooksFile } from "../services/hook-serialization.js";
import { parseMcpServerEntry, parseMcpServersDocument } from "../services/mcp-config-bridge.js";
import { mergeMuseSettingsContent } from "../services/merged-host-config.js";
import type {
  HookMetadata,
  McpServerMetadata,
  PlatformDefinition,
  Resource,
  ResourceCreateInput,
  SerializedFile,
  SerializeOptions,
} from "../types.js";

const PROJECT_INSTRUCTION_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".agents/AGENTS.md",
  ".claude/CLAUDE.md",
] as const;

const PROJECT_SKILL_DIRS = [".agents/skills/", ".claude/skills/", ".codex/skills/"] as const;

const GLOBAL_SKILL_DIRS = [
  { full: (home: string) => join(home, ".config/muse/skills"), source: "~/.config/muse/skills" },
  { full: (home: string) => join(home, ".agents/skills"), source: "~/.agents/skills" },
  { full: (home: string) => join(home, ".claude/skills"), source: "~/.claude/skills" },
  { full: (home: string) => join(home, ".codex/skills"), source: "~/.codex/skills" },
] as const;

const MUSE_SETTINGS_RELATIVE = ".config/muse/settings.json";
const MUSE_SETTINGS_DISPLAY = "~/.config/muse/settings.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function museMcpMetadata(entry: unknown): McpServerMetadata | null {
  const metadata = parseMcpServerEntry(entry);
  if (!metadata || !isRecord(entry)) return null;
  if (typeof entry.enabled === "boolean") {
    metadata.enabled = entry.enabled;
  }
  if (typeof entry.mode === "string") {
    metadata.mode = entry.mode;
  }
  if (typeof entry.framing === "string") {
    metadata.framing = entry.framing;
  }
  return metadata;
}

function emitMuseMcpServer(meta: McpServerMetadata): Record<string, unknown> {
  const enabled = meta.enabled ?? true;
  const mode = meta.mode ?? "required";
  if (meta.transport === "http" || Boolean(meta.url)) {
    const entry: Record<string, unknown> = {
      transport: "streamable_http",
      enabled,
      mode,
    };
    if (meta.url) entry.url = meta.url;
    if (meta.headers && Object.keys(meta.headers).length > 0) {
      entry.headers = meta.headers;
    }
    return entry;
  }

  const entry: Record<string, unknown> = {
    transport: "stdio",
    enabled,
    mode,
  };
  if (meta.command) entry.command = meta.command;
  entry.args = meta.args ?? [];
  if (meta.env && Object.keys(meta.env).length > 0) {
    entry.env = meta.env;
  }
  if (typeof meta.framing === "string" && meta.framing.length > 0) {
    entry.framing = meta.framing;
  }
  return entry;
}

/**
 * Native serializer for Muse Code (Meta).
 * Project: AGENTS.md, `.agents/skills/`, `.muse/hooks.json`.
 * Home: merge-safe `~/.config/muse/settings.json` (`schema_version`, `mcp_servers`, hooks).
 */
export class MuseCodeSerializer extends BaseSerializer {
  readonly platformId = "muse-code";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const platform = getPlatform("muse-code");
    if (!platform) throw new Error("muse-code platform not found in registry");
    this.platform = platform;
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

    for (const candidate of PROJECT_INSTRUCTION_CANDIDATES) {
      const content = this.readFile(join(projectRoot, candidate));
      if (!content || content.trim().length === 0) continue;
      resources.push(
        this.makeResource("instruction", "muse-code-instructions", content, candidate),
      );
      break;
    }

    const seenSkillNames = new Set<string>();
    for (const skillsDir of PROJECT_SKILL_DIRS) {
      this.appendSkillsFrom(projectRoot, skillsDir, resources, seenSkillNames);
    }

    const hooksPath = this.platform.projectPaths.hooks ?? ".muse/hooks.json";
    resources.push(...scanHooksFile(join(projectRoot, hooksPath), hooksPath));

    return resources;
  }

  async scanGlobal(homeRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];
    const seenSkillNames = new Set<string>();

    for (const dir of GLOBAL_SKILL_DIRS) {
      for (const resource of this.scanSkillsDirAt(dir.full(homeRoot), dir.source)) {
        if (resource.type !== "skill") continue;
        if (seenSkillNames.has(resource.name)) continue;
        seenSkillNames.add(resource.name);
        resources.push(resource);
      }
    }

    const settingsPath = join(homeRoot, MUSE_SETTINGS_RELATIVE);
    const settingsContent = this.readFile(settingsPath);
    if (settingsContent) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(settingsContent) as unknown;
      } catch {
        parsed = undefined;
      }
      const servers = parseMcpServersDocument(parsed);
      const rawServers =
        isRecord(parsed) && isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
      for (const [name, metadata] of Object.entries(servers)) {
        const extras = museMcpMetadata(rawServers[name]);
        resources.push(
          this.makeResource(
            "mcp_server",
            name,
            "",
            MUSE_SETTINGS_DISPLAY,
            extras ?? metadata,
          ),
        );
      }
      resources.push(...parseHooksJsonContent(settingsContent, MUSE_SETTINGS_DISPLAY));
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
      this.toTargetRelativePath(targetPaths.skills, target) ?? ".agents/skills/";
    const hooksPath =
      this.toTargetRelativePath(targetPaths.hooks, target) ?? ".muse/hooks.json";

    const instructions = resources.filter((r) => r.type === "instruction");
    if (instructions.length > 0) {
      files.push({
        path: instructionsPath,
        content: instructions.map((r) => r.content).join("\n\n"),
      });
    }

    for (const r of resources.filter((r) => r.type === "skill")) {
      files.push(
        ...this.emitSkillWithAuxiliary(r, `${skillsPath}${r.name}/SKILL.md`, options),
      );
    }

    const hooks = resources.filter((r) => r.type === "hook");
    if (hooks.length > 0) {
      files.push({
        path: hooksPath,
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
    homeRoot: string,
    options: SerializeOptions,
  ): SerializedFile[] {
    const files: SerializedFile[] = [];
    const skillsPath =
      this.toTargetRelativePath(this.platform.globalPaths.skills, "global")
      ?? ".config/muse/skills/";

    for (const r of resources.filter((resource) => resource.type === "skill")) {
      files.push(
        ...this.emitSkillWithAuxiliary(
          r,
          `${skillsPath}${r.name}/SKILL.md`,
          options,
        ),
      );
    }

    const mcpPath = this.platform.globalPaths.mcp ?? MUSE_SETTINGS_DISPLAY;
    const mcpServers = this.mcpServersForTarget(resources, mcpPath);
    const hooks = resources.filter((resource) => resource.type === "hook");
    if (mcpServers.length === 0 && hooks.length === 0) {
      return files;
    }

    const overlay: Record<string, unknown> = { schema_version: 1 };
    if (mcpServers.length > 0) {
      const servers: Record<string, Record<string, unknown>> = {};
      for (const server of mcpServers) {
        servers[server.name] = emitMuseMcpServer(server.metadata as McpServerMetadata);
      }
      overlay.mcp_servers = servers;
    }
    if (hooks.length > 0) {
      overlay.hooks = buildHooksJson(
        hooks.map((r) => ({
          ...(r.metadata as HookMetadata),
          name: r.name,
        })),
      ).hooks;
    }

    const existing = this.readFile(join(homeRoot, MUSE_SETTINGS_RELATIVE));
    files.push({
      path: MUSE_SETTINGS_RELATIVE,
      content: mergeMuseSettingsContent(existing, JSON.stringify(overlay)),
    });

    return files;
  }
}
