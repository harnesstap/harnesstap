import { join } from "node:path";
import { BaseSerializer } from "./base-serializer.js";
import { getPlatform } from "./registry.js";
import { parseMcpServerEntry, parseMcpServersDocument } from "../services/mcp-config-bridge.js";
import { mergeMinimaxMcpContent } from "../services/merged-host-config.js";
import type {
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
] as const;

const PROJECT_SKILL_DIRS = [".minimax/skills/", ".agents/skills/", ".claude/skills/"] as const;

const GLOBAL_SKILL_DIRS = [
  { full: (home: string) => join(home, ".minimax/skills"), source: "~/.minimax/skills" },
  { full: (home: string) => join(home, ".agents/skills"), source: "~/.agents/skills" },
  { full: (home: string) => join(home, ".claude/skills"), source: "~/.claude/skills" },
  { full: (home: string) => join(home, ".codex/skills"), source: "~/.codex/skills" },
] as const;

const PROJECT_MCP_PATH = ".mcp.json";
const MINIMAX_MCP_RELATIVE = ".minimax/mcp.json";
const MINIMAX_MCP_DISPLAY = "~/.minimax/mcp.json";
const MINIMAX_MCP_LEGACY_RELATIVE = ".minimax/mcp/mcp.json";
const MINIMAX_MCP_LEGACY_DISPLAY = "~/.minimax/mcp/mcp.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function minimaxMcpMetadata(entry: unknown): McpServerMetadata | null {
  const metadata = parseMcpServerEntry(entry);
  if (!metadata || !isRecord(entry)) return null;
  if (typeof entry.enabled === "boolean") {
    metadata.enabled = entry.enabled;
  }
  if (typeof entry.type === "string") {
    metadata.connection_type = entry.type;
  }
  return metadata;
}

function emitMinimaxMcpServer(meta: McpServerMetadata): Record<string, unknown> {
  const enabled = meta.enabled ?? true;
  if (meta.transport === "http" || Boolean(meta.url)) {
    const type = remoteTransportType(meta);
    const entry: Record<string, unknown> = { type, enabled };
    if (meta.url) entry.url = meta.url;
    if (meta.headers && Object.keys(meta.headers).length > 0) {
      entry.headers = meta.headers;
    }
    return entry;
  }

  const entry: Record<string, unknown> = {
    type: "stdio",
    enabled,
  };
  if (meta.command) entry.command = meta.command;
  entry.args = meta.args ?? [];
  if (meta.env && Object.keys(meta.env).length > 0) {
    entry.env = meta.env;
  }
  return entry;
}

function remoteTransportType(meta: McpServerMetadata): string {
  const raw = meta.connection_type?.toLowerCase();
  if (raw === "sse") return "sse";
  if (raw === "http") return "http";
  if (raw === "streamable-http" || raw === "streamable_http") return "streamable-http";
  return "streamable-http";
}

/**
 * Native serializer for MiniMax Code (`mcode`).
 * Project: AGENTS.md, `.minimax/skills/`, `.mcp.json`.
 * Home: merge-safe `~/.minimax/mcp.json`. Install dir `~/.minimax-code` is not user data.
 */
export class MiniMaxCodeSerializer extends BaseSerializer {
  readonly platformId = "minimax-code";
  readonly platform: PlatformDefinition;

  constructor() {
    super();
    const platform = getPlatform("minimax-code");
    if (!platform) throw new Error("minimax-code platform not found in registry");
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

  private scanMcpFile(
    fullPath: string,
    displayPath: string,
    resources: ResourceCreateInput[],
    seenNames: Set<string>,
  ): void {
    const content = this.readFile(fullPath);
    if (!content) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      return;
    }
    const servers = parseMcpServersDocument(parsed);
    const rawServers =
      isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
    for (const [name, metadata] of Object.entries(servers)) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const extras = minimaxMcpMetadata(rawServers[name]);
      resources.push(
        this.makeResource(
          "mcp_server",
          name,
          "",
          displayPath,
          extras ?? metadata,
        ),
      );
    }
  }

  async scan(projectRoot: string): Promise<ResourceCreateInput[]> {
    const resources: ResourceCreateInput[] = [];

    for (const candidate of PROJECT_INSTRUCTION_CANDIDATES) {
      const content = this.readFile(join(projectRoot, candidate));
      if (!content || content.trim().length === 0) continue;
      resources.push(
        this.makeResource("instruction", "minimax-code-instructions", content, candidate),
      );
      break;
    }

    const seenSkillNames = new Set<string>();
    for (const skillsDir of PROJECT_SKILL_DIRS) {
      this.appendSkillsFrom(projectRoot, skillsDir, resources, seenSkillNames);
    }

    this.scanMcpFile(
      join(projectRoot, PROJECT_MCP_PATH),
      PROJECT_MCP_PATH,
      resources,
      new Set(),
    );

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

    const seenMcpNames = new Set<string>();
    this.scanMcpFile(
      join(homeRoot, MINIMAX_MCP_RELATIVE),
      MINIMAX_MCP_DISPLAY,
      resources,
      seenMcpNames,
    );
    this.scanMcpFile(
      join(homeRoot, MINIMAX_MCP_LEGACY_RELATIVE),
      MINIMAX_MCP_LEGACY_DISPLAY,
      resources,
      seenMcpNames,
    );

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
      this.toTargetRelativePath(targetPaths.skills, target) ?? ".minimax/skills/";

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

    const mcpServers = this.mcpServersForTarget(resources, PROJECT_MCP_PATH);
    if (mcpServers.length > 0) {
      const servers: Record<string, Record<string, unknown>> = {};
      for (const server of mcpServers) {
        servers[server.name] = emitMinimaxMcpServer(server.metadata as McpServerMetadata);
      }
      const existing = this.readFile(join(projectRoot, PROJECT_MCP_PATH));
      files.push({
        path: PROJECT_MCP_PATH,
        content: mergeMinimaxMcpContent(existing, JSON.stringify({ mcpServers: servers })),
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
      ?? ".minimax/skills/";

    for (const r of resources.filter((resource) => resource.type === "skill")) {
      files.push(
        ...this.emitSkillWithAuxiliary(
          r,
          `${skillsPath}${r.name}/SKILL.md`,
          options,
        ),
      );
    }

    const mcpPath = this.platform.globalPaths.mcp ?? MINIMAX_MCP_DISPLAY;
    const mcpServers = this.mcpServersForTarget(resources, mcpPath);
    if (mcpServers.length === 0) {
      return files;
    }

    const servers: Record<string, Record<string, unknown>> = {};
    for (const server of mcpServers) {
      servers[server.name] = emitMinimaxMcpServer(server.metadata as McpServerMetadata);
    }

    const existing = this.readFile(join(homeRoot, MINIMAX_MCP_RELATIVE));
    files.push({
      path: MINIMAX_MCP_RELATIVE,
      content: mergeMinimaxMcpContent(existing, JSON.stringify({ mcpServers: servers })),
    });

    return files;
  }
}
