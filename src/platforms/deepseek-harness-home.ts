import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { McpServerMetadata, ResourceCreateInput } from "../types.js";

export const HARNESSTAP_PATCH_PREFIX = "harnesstap-";
export const MCP_CLIENT_PLUGIN_NAME = "@deepseek-ai/dsh-mcp-client";
export const HOOKS_CLAUDE_CODE_PLUGIN_NAME = "@deepseek-ai/dsh-hooks-claude-code";
export const MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface CordisInsertItem {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resolveDshHome(homeRoot: string): string {
  const fromEnv = process.env.DSH_HOME?.trim();
  if (fromEnv) return fromEnv;
  return join(homeRoot, ".dsh");
}

export function sanitizePresetId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return "agent";
  return slug;
}

export function mcpResourceToInsertItem(
  serverName: string,
  metadata: McpServerMetadata,
): CordisInsertItem | null {
  if (!MCP_SERVER_NAME_RE.test(serverName)) return null;
  const config: Record<string, unknown> = { serverName };
  if (metadata.transport === "http" || metadata.url) {
    config.transport = "streamable-http";
    if (metadata.url) config.url = metadata.url;
    if (metadata.headers && Object.keys(metadata.headers).length > 0) {
      config.headers = metadata.headers;
    }
  } else {
    config.transport = "stdio";
    if (metadata.command) config.command = metadata.command;
    if (metadata.args && metadata.args.length > 0) config.args = metadata.args;
    if (metadata.env && Object.keys(metadata.env).length > 0) config.env = metadata.env;
  }
  return {
    id: `${HARNESSTAP_PATCH_PREFIX}mcp-${serverName}`,
    name: MCP_CLIENT_PLUGIN_NAME,
    config,
  };
}

export function hooksBridgeInsertItem(absoluteConfigPath: string): CordisInsertItem {
  return {
    id: `${HARNESSTAP_PATCH_PREFIX}hooks-claude-code`,
    name: HOOKS_CLAUDE_CODE_PLUGIN_NAME,
    config: { configPath: absoluteConfigPath },
  };
}

function isHarnessTapInsert(item: unknown): boolean {
  return isRecord(item) && typeof item.id === "string" && item.id.startsWith(HARNESSTAP_PATCH_PREFIX);
}

export function mergeCordisPatch(
  existing: string | undefined,
  rows: CordisInsertItem[],
): string {
  if (!existing || existing.trim().length === 0) {
    return stringify(rows.length > 0 ? [{ insert: rows }] : []);
  }
  const parsed: unknown = parse(existing);
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid cordis.patch.yml: expected a YAML list of patch operations");
  }
  const nextOps: unknown[] = [];
  for (const op of parsed) {
    if (!isRecord(op) || !Array.isArray(op.insert)) {
      nextOps.push(op);
      continue;
    }
    const kept = op.insert.filter((item) => !isHarnessTapInsert(item));
    if (kept.length > 0) {
      nextOps.push({ ...op, insert: kept });
    }
  }
  if (rows.length > 0) {
    nextOps.push({ insert: rows });
  }
  return stringify(nextOps);
}

function mcpMetadataFromConfig(config: Record<string, unknown>): McpServerMetadata {
  const transport = config.transport === "streamable-http" ? "http" : "stdio";
  const headers = isRecord(config.headers)
    ? Object.fromEntries(
        Object.entries(config.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined;
  const env = isRecord(config.env)
    ? Object.fromEntries(
        Object.entries(config.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined;
  const args = Array.isArray(config.args)
    ? config.args.filter((value): value is string => typeof value === "string")
    : undefined;
  return {
    transport,
    command: typeof config.command === "string" ? config.command : undefined,
    args,
    url: typeof config.url === "string" ? config.url : undefined,
    env,
    headers,
  };
}

function collectMcpItems(node: unknown, acc: ResourceCreateInput[], source: string): void {
  if (Array.isArray(node)) {
    for (const item of node) collectMcpItems(item, acc, source);
    return;
  }
  if (!isRecord(node)) return;
  if (Array.isArray(node.insert)) {
    collectMcpItems(node.insert, acc, source);
    return;
  }
  if (node.name !== MCP_CLIENT_PLUGIN_NAME || !isRecord(node.config)) return;
  const serverName = node.config.serverName;
  if (typeof serverName !== "string" || serverName.length === 0) return;
  acc.push({
    type: "mcp_server",
    name: serverName,
    description: "",
    content: "",
    metadata: mcpMetadataFromConfig(node.config),
    source,
  });
}

export function parseCordisMcpServers(content: string, source: string): ResourceCreateInput[] {
  const parsed: unknown = parse(content);
  const resources: ResourceCreateInput[] = [];
  collectMcpItems(parsed, resources, source);
  return resources;
}

export interface SettingsOverlay {
  model?: { provider?: string; model: string };
  permissionPreset?: string;
}

export function mergeSettingsYaml(existing: string | undefined, overlay: SettingsOverlay): string {
  let doc: Record<string, unknown> = {};
  if (existing && existing.trim().length > 0) {
    const parsed: unknown = parse(existing);
    if (!isRecord(parsed)) {
      throw new Error("Invalid settings.yaml: expected a YAML mapping");
    }
    doc = { ...parsed };
  }
  if (overlay.model) {
    const previous = isRecord(doc["agent-default-model"]) ? doc["agent-default-model"] : {};
    doc["agent-default-model"] = {
      ...previous,
      provider: overlay.model.provider ?? "deepseek",
      model: overlay.model.model,
    };
  }
  if (overlay.permissionPreset) {
    const previous = isRecord(doc.permission) ? doc.permission : {};
    doc.permission = { ...previous, defaultPreset: overlay.permissionPreset };
  }
  return stringify(doc);
}

export function parseSettingsResources(content: string, source: string): ResourceCreateInput[] {
  const parsed: unknown = parse(content);
  if (!isRecord(parsed)) return [];
  const resources: ResourceCreateInput[] = [];
  const modelSection = parsed["agent-default-model"];
  if (isRecord(modelSection) && typeof modelSection.model === "string") {
    resources.push({
      type: "model_config",
      name: "default",
      description: "",
      content: "",
      metadata: {
        model: modelSection.model,
        ...(typeof modelSection.provider === "string" ? { provider: modelSection.provider } : {}),
      },
      source,
    });
  }
  const permission = parsed.permission;
  if (isRecord(permission) && typeof permission.defaultPreset === "string") {
    resources.push({
      type: "permission",
      name: "default",
      description: "",
      content: "",
      metadata: { action: "allow", pattern: permission.defaultPreset },
      source,
    });
  }
  return resources;
}
