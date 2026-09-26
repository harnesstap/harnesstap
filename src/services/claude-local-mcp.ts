import { resolve } from "node:path";
import type { McpServerMetadata, ResourceCreateInput } from "../types.js";
import { parseMcpServersDocument } from "./mcp-config-bridge.js";

export const CLAUDE_USER_MCP_SOURCE = "~/.claude.json";
export const CLAUDE_LOCAL_MCP_SOURCE_PREFIX = "~/.claude.json#local:";

export function claudeLocalMcpSource(projectAbsPath: string): string {
  return `${CLAUDE_LOCAL_MCP_SOURCE_PREFIX}${resolve(projectAbsPath)}`;
}

export function parseClaudeLocalMcpProjectPath(
  source: string | undefined,
): string | null {
  if (!source?.startsWith(CLAUDE_LOCAL_MCP_SOURCE_PREFIX)) {
    return null;
  }
  const rest = source.slice(CLAUDE_LOCAL_MCP_SOURCE_PREFIX.length);
  return rest.length > 0 ? rest : null;
}

export function isClaudeLocalMcpSource(source: string | undefined): boolean {
  return parseClaudeLocalMcpProjectPath(source) !== null;
}

export function isClaudeLocalMcpResource(resource: {
  source?: string;
  metadata?: unknown;
}): boolean {
  if (isClaudeLocalMcpSource(resource.source)) {
    return true;
  }
  const metadata = resource.metadata;
  if (
    metadata !== null
    && typeof metadata === "object"
    && !Array.isArray(metadata)
    && (metadata as { claude_mcp_scope?: unknown }).claude_mcp_scope === "local"
  ) {
    return true;
  }
  return false;
}

/** Strip the local-scope fragment so inventory groups under `~/.claude.json`. */
export function inventorySourceForMatching(source: string): string {
  return isClaudeLocalMcpSource(source) ? CLAUDE_USER_MCP_SOURCE : source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ClaudeLocalMcpServer {
  projectPath: string;
  name: string;
  metadata: McpServerMetadata;
}

function projectKeysMatch(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

/**
 * Local-scope servers from `projects[<absPath>].mcpServers`.
 * When `projectRoot` is set, only that project's entry is returned.
 */
export function listClaudeLocalMcpServers(
  document: unknown,
  projectRoot?: string,
): ClaudeLocalMcpServer[] {
  if (!isRecord(document) || !isRecord(document.projects)) {
    return [];
  }

  const wanted = projectRoot ? resolve(projectRoot) : undefined;
  const listed: ClaudeLocalMcpServer[] = [];

  for (const [projectPath, entry] of Object.entries(document.projects)) {
    if (wanted && !projectKeysMatch(projectPath, wanted)) {
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }
    const servers = parseMcpServersDocument({ mcpServers: entry.mcpServers });
    for (const [name, metadata] of Object.entries(servers)) {
      listed.push({
        projectPath,
        name,
        metadata: {
          ...metadata,
          claude_mcp_scope: "local",
          claude_project_path: resolve(projectPath),
        },
      });
    }
  }

  return listed;
}

export function localMcpCreateInputsFromDocument(
  document: unknown,
  projectRoot: string | undefined,
  takenNames: ReadonlySet<string>,
): ResourceCreateInput[] {
  const taken = new Set(takenNames);
  const resources: ResourceCreateInput[] = [];

  for (const server of listClaudeLocalMcpServers(document, projectRoot)) {
    let name = server.name;
    if (taken.has(name)) {
      name = `${server.name}@local`;
      let suffix = 2;
      while (taken.has(name)) {
        name = `${server.name}@local${suffix}`;
        suffix += 1;
      }
    }
    taken.add(name);
    resources.push({
      type: "mcp_server",
      name,
      description: "",
      content: "",
      metadata: server.metadata,
      source: claudeLocalMcpSource(server.projectPath),
    });
  }

  return resources;
}
