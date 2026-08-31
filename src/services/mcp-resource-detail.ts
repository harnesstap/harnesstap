import type { Resource, ResourceMetadata } from "../types.js";
import {
  emitCursorMcpServerEntry,
  parseMcpServerEntry,
} from "./mcp-config-bridge.js";
import { readResourceContentFromPathHint } from "./resource-editor-path.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mcpServersRecord(document: unknown): Record<string, unknown> | null {
  if (!isRecord(document)) {
    return null;
  }
  const serversRaw = document.mcpServers ?? document.mcp_servers ?? document.mcp;
  return isRecord(serversRaw) ? serversRaw : null;
}

/** Pretty-print one server entry as an `mcpServers` document fragment. */
export function formatMcpServerConfig(name: string, entry: unknown): string {
  return `${JSON.stringify({ mcpServers: { [name]: entry } }, null, 2)}\n`;
}

export function extractMcpServerConfigFromFile(
  fileContent: string,
  name: string,
): string | null {
  try {
    const document = JSON.parse(fileContent) as unknown;
    const servers = mcpServersRecord(document);
    if (!servers || !Object.hasOwn(servers, name)) {
      return null;
    }
    return formatMcpServerConfig(name, servers[name]);
  } catch {
    return null;
  }
}

function formatMcpServerFromMetadata(
  name: string,
  metadata: ResourceMetadata,
): string | null {
  const parsed = parseMcpServerEntry(metadata);
  if (!parsed) {
    return null;
  }
  const entry = emitCursorMcpServerEntry(parsed);
  if (Object.keys(entry).length === 0) {
    return null;
  }
  return formatMcpServerConfig(name, entry);
}

export function overlayMcpServerDetail(
  resource: Pick<
    Resource,
    "type" | "name" | "source" | "origin_ref" | "content" | "metadata" | "updated_at"
  >,
  pathHint?: string | null,
): { content: string; updatedAt: string } {
  if (resource.type !== "mcp_server") {
    return { content: resource.content, updatedAt: resource.updated_at };
  }

  const candidates = [pathHint, resource.source, resource.origin_ref];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || trimmed === "manual") {
      continue;
    }
    try {
      const onDisk = readResourceContentFromPathHint(trimmed);
      const extracted = extractMcpServerConfigFromFile(onDisk.content, resource.name);
      if (extracted) {
        return { content: extracted, updatedAt: onDisk.updatedAt };
      }
    } catch {
      // try the next path candidate
    }
  }

  const fromMetadata = formatMcpServerFromMetadata(
    resource.name,
    resource.metadata,
  );
  if (fromMetadata) {
    return { content: fromMetadata, updatedAt: resource.updated_at };
  }

  return { content: resource.content, updatedAt: resource.updated_at };
}
