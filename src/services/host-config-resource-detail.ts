import type { HookMetadata, PermissionMetadata } from "../types.js";
import { parseHooksJsonContent } from "./hook-serialization.js";

const PERMISSION_ACTIONS = ["allow", "deny", "ask"] as const satisfies ReadonlyArray<
  PermissionMetadata["action"]
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatJsonFragment(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const PERMISSION_RESOURCE_TYPES = ["permission", "hook", "env_var"] as const;

/** Permission, hook, and env var identities present in a shared settings file. */
export function hostConfigResourcesFromContent(
  content: string,
): Array<{ type: (typeof PERMISSION_RESOURCE_TYPES)[number]; name: string }> {
  const resources: Array<{
    type: (typeof PERMISSION_RESOURCE_TYPES)[number];
    name: string;
  }> = [];
  const seen = new Set<string>();
  const add = (
    type: (typeof PERMISSION_RESOURCE_TYPES)[number],
    name: string,
  ) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const key = `${type}:${trimmed}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    resources.push({ type, name: trimmed });
  };

  const document = parseJsonObject(content);
  if (document && isRecord(document.permissions)) {
    for (const action of PERMISSION_ACTIONS) {
      const list = document.permissions[action];
      if (!Array.isArray(list)) {
        continue;
      }
      for (const pattern of list) {
        if (typeof pattern === "string" && pattern.trim()) {
          add("permission", `${action}-${pattern}`);
        }
      }
    }
  }
  for (const hook of hookResourcesFromContent(content)) {
    add("hook", hook.name);
  }
  if (document && isRecord(document.env)) {
    for (const name of Object.keys(document.env)) {
      add("env_var", name);
    }
  }
  return resources;
}

export function parsePermissionResourceName(
  name: string,
): Pick<PermissionMetadata, "action" | "pattern"> | null {
  const trimmed = name.trim();
  for (const action of PERMISSION_ACTIONS) {
    const prefix = `${action}-`;
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) {
      return { action, pattern: trimmed.slice(prefix.length) };
    }
  }
  return null;
}

function permissionPatternPresent(
  permissions: unknown,
  action: PermissionMetadata["action"],
  pattern: string,
): boolean {
  if (!isRecord(permissions)) {
    return false;
  }
  const list = permissions[action];
  return Array.isArray(list) && list.some((item) => item === pattern);
}

function hookResourcesFromContent(content: string) {
  const direct = parseHooksJsonContent(content, "");
  if (direct.length > 0) {
    return direct;
  }
  const document = parseJsonObject(content);
  if (!document) {
    return [];
  }
  return parseHooksJsonContent(JSON.stringify({ hooks: document }), "");
}

function scopeToPermission(content: string, name: string): string {
  const parsed = parsePermissionResourceName(name);
  if (!parsed) {
    return content;
  }
  const document = parseJsonObject(content);
  if (!document) {
    return content;
  }
  if (permissionPatternPresent(document.permissions, parsed.action, parsed.pattern)) {
    return formatJsonFragment({
      permissions: { [parsed.action]: [parsed.pattern] },
    });
  }
  return formatJsonFragment({ permissions: {} });
}

function scopeToHook(content: string, name: string): string {
  if (!parseJsonObject(content)) {
    return content;
  }
  const needle = name.trim().toLowerCase();
  const match = hookResourcesFromContent(content).find(
    (resource) => resource.name.toLowerCase() === needle,
  );
  if (!match) {
    return formatJsonFragment({ hooks: {} });
  }
  const metadata = match.metadata as HookMetadata;
  const entry = metadata.hook_entry ?? { command: match.content };
  return formatJsonFragment({
    hooks: { [metadata.event]: [entry] },
  });
}

function scopeToEnvVar(content: string, name: string): string {
  const document = parseJsonObject(content);
  if (!document) {
    return content;
  }
  if (!isRecord(document.env) || !Object.hasOwn(document.env, name)) {
    return formatJsonFragment({ env: {} });
  }
  return formatJsonFragment({ env: { [name]: document.env[name] } });
}

/**
 * Restrict a shared host settings payload to one permission, hook, or env var
 * so live→after-apply diffs do not include sibling keys in the same file.
 */
export function scopeHostConfigToResource(
  content: string | null,
  resource: { type: string; name: string },
): string | null {
  if (content === null) {
    return null;
  }
  const name = resource.name.trim();
  if (!name) {
    return content;
  }
  switch (resource.type) {
    case "permission":
      return scopeToPermission(content, name);
    case "hook":
      return scopeToHook(content, name);
    case "env_var":
      return scopeToEnvVar(content, name);
    default:
      return content;
  }
}
