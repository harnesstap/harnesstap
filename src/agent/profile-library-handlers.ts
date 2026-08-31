import { listPlugins } from "../models/plugin-model.js";
import {
  createResource,
  findResourceByKey,
  listResources,
  resolveResource,
} from "../models/resource.js";
import { overlayMcpServerDetail } from "../services/mcp-resource-detail.js";
import { pluginResourceShowExtras } from "../services/plugin-resource-show.js";
import { resourceAttacherPayload } from "../services/resource-attachers.js";
import { readResourceContentFromPathHint } from "../services/resource-editor-path.js";
import { truncateResourceContent } from "../services/resource-show.js";
import { parseUntrackedResourceSelector } from "../services/untracked-resource.js";
import { MATERIAL_RESOURCE_TYPES, type MaterialResourceType } from "../types.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export function handleLibraryPlugins(): Response {
  return jsonResponse({
    plugins: listPlugins().map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      tags: plugin.tags,
      description: plugin.description ?? null,
    })),
  });
}

export function handleLibraryResources(): Response {
  return jsonResponse({
    resources: listResources().map((resource) => ({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      namespace: resource.namespace ?? null,
      description: resource.description ?? null,
      source: resource.source,
      updated_at: resource.updated_at,
      origin_kind: resource.origin_kind,
    })),
  });
}

export function handleLibraryResourceDetail(
  selector: string,
  options?: { pathHint?: string | null },
): Response {
  const trimmed = selector.trim();
  if (!trimmed) {
    return jsonResponse(
      { error: "invalid_selector", message: "Resource selector is required" },
      { status: 400 },
    );
  }

  const untracked = parseUntrackedResourceSelector(trimmed);
  if (untracked) {
    const pathHint = options?.pathHint?.trim();
    if (!pathHint) {
      return jsonResponse(
        { error: "not_found", message: `Resource not found: ${trimmed}` },
        { status: 404 },
      );
    }
    try {
      const onDisk = readResourceContentFromPathHint(pathHint);
      const content = truncateResourceContent(onDisk.content, 80);
      return jsonResponse({
        resource: {
          id: trimmed,
          type: untracked.type,
          name: untracked.name,
          namespace: null,
          description: null,
          source: pathHint,
          origin_kind: "untracked",
          origin_ref: onDisk.path,
          updated_at: onDisk.updatedAt,
          content,
          content_truncated: onDisk.content.split("\n").length > 80,
          attached_profiles: [],
          attached_plugins: [],
          active_profile: null,
          in_active_profile: false,
        },
      });
    } catch (error) {
      return jsonResponse(
        {
          error: "not_found",
          message:
            error instanceof Error
              ? error.message
              : `Resource not found: ${trimmed}`,
        },
        { status: 404 },
      );
    }
  }

  const result = resolveResource(trimmed);
  if (result.status === "not_found") {
    return jsonResponse(
      { error: "not_found", message: `Resource not found: ${trimmed}` },
      { status: 404 },
    );
  }
  if (result.status === "ambiguous") {
    return jsonResponse(
      {
        error: "ambiguous",
        message: `Ambiguous resource name: ${trimmed}`,
        matches: result.matches.map((resource) => ({
          id: resource.id,
          type: resource.type,
          name: resource.name,
          namespace: resource.namespace || null,
        })),
      },
      { status: 409 },
    );
  }

  const resource = result.resource;
  const extras = pluginResourceShowExtras(resource);
  const attachers = resourceAttacherPayload(resource.id);
  const overlay =
    resource.type === "mcp_server"
      ? overlayMcpServerDetail(resource, options?.pathHint)
      : { content: resource.content, updatedAt: resource.updated_at };
  return jsonResponse({
    resource: {
      id: resource.id,
      type: resource.type,
      name: resource.name,
      namespace: resource.namespace || null,
      description: resource.description || null,
      source: resource.source,
      origin_kind: resource.origin_kind,
      origin_ref: resource.origin_ref || null,
      updated_at: overlay.updatedAt,
      content: truncateResourceContent(overlay.content, 80),
      content_truncated: overlay.content.split("\n").length > 80,
      ...attachers,
      ...(extras ?? {}),
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const METADATA_KEYS_BY_TYPE: Record<MaterialResourceType, ReadonlySet<string>> = {
  instruction: new Set(),
  skill: new Set(["scripts", "references"]),
  rule: new Set(["globs", "always_apply"]),
  mcp_server: new Set([
    "transport",
    "command",
    "url",
    "args",
    "env",
    "headers",
    "connection_type",
    "env_file",
    "auth",
  ]),
  permission: new Set(["action", "pattern"]),
  hook: new Set([
    "event",
    "script",
    "commandWindows",
    "timeout",
    "matcher",
    "hook_entry",
  ]),
  agent: new Set([
    "model",
    "reasoning_effort",
    "sandbox_mode",
    "readonly",
    "is_background",
    "extra",
    "wire_format",
  ]),
  command: new Set(),
  env_var: new Set(["key", "value"]),
  model_config: new Set(["model", "provider"]),
};

function requireMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string" || !value.trim()) {
    return `${key} is required`;
  }
  return null;
}

function validateResourceMetadata(
  type: MaterialResourceType,
  content: string,
  metadata: Record<string, unknown>,
): string | null {
  switch (type) {
    case "instruction":
    case "skill":
    case "rule":
    case "agent":
    case "command":
      if (!content.trim()) {
        return "content is required";
      }
      return null;
    case "permission": {
      const action = metadata.action;
      if (
        typeof action !== "string"
        || !["allow", "deny", "ask"].includes(action)
      ) {
        return "action must be one of: allow, deny, ask";
      }
      return requireMetadataString(metadata, "pattern");
    }
    case "env_var":
      return (
        requireMetadataString(metadata, "key")
        ?? requireMetadataString(metadata, "value")
      );
    case "hook": {
      const eventError = requireMetadataString(metadata, "event");
      if (eventError) {
        return eventError;
      }
      return requireMetadataString(metadata, "script");
    }
    case "mcp_server": {
      const transport = metadata.transport;
      if (transport !== "stdio" && transport !== "http") {
        return "transport must be stdio or http";
      }
      if (transport === "stdio") {
        return requireMetadataString(metadata, "command");
      }
      return requireMetadataString(metadata, "url");
    }
    case "model_config":
      return requireMetadataString(metadata, "model");
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return null;
    }
  }
}

export async function handleLibraryResourceCreate(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }

  if (
    typeof body.type !== "string"
    || !(MATERIAL_RESOURCE_TYPES as readonly string[]).includes(body.type)
  ) {
    return jsonResponse(
      {
        error: "invalid_type",
        message: `type must be one of: ${MATERIAL_RESOURCE_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const type = body.type as MaterialResourceType;

  if (typeof body.name !== "string" || !body.name.trim()) {
    return jsonResponse(
      { error: "invalid_body", message: "name is required" },
      { status: 400 },
    );
  }
  const name = body.name.trim();

  if (findResourceByKey(type, name, "")) {
    return jsonResponse(
      {
        error: "resource_conflict",
        message: `Resource ${type}:${name} already exists.`,
      },
      { status: 409 },
    );
  }

  const description = typeof body.description === "string" ? body.description : "";
  const content = typeof body.content === "string" ? body.content : "";
  const metadata = isRecord(body.metadata) ? body.metadata : {};

  const metadataError = validateResourceMetadata(type, content, metadata);
  if (metadataError) {
    return jsonResponse(
      { error: "invalid_body", message: metadataError },
      { status: 400 },
    );
  }

  const allowedKeys = METADATA_KEYS_BY_TYPE[type];
  const unknownKey = Object.keys(metadata).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    return jsonResponse(
      { error: "invalid_body", message: `unknown metadata field: ${unknownKey}` },
      { status: 400 },
    );
  }

  const resource = createResource({
    type,
    name,
    description,
    content,
    metadata,
    source: "manual",
    origin_kind: "manual",
  });

  return jsonResponse({ resource });
}
