import type { McpOAuthAuthMetadata, McpServerMetadata } from "../types.js";
import { substituteEnvironmentVars } from "./environment-var-substitution.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string") {
      result[key] = entryValue;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseAuthMetadata(value: unknown): McpOAuthAuthMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const auth: McpOAuthAuthMetadata = {};
  if (typeof value.CLIENT_ID === "string") {
    auth.CLIENT_ID = value.CLIENT_ID;
  }
  if (typeof value.CLIENT_SECRET === "string") {
    auth.CLIENT_SECRET = value.CLIENT_SECRET;
  }
  if (Array.isArray(value.scopes)) {
    const scopes = value.scopes.filter((scope): scope is string => typeof scope === "string");
    if (scopes.length > 0) {
      auth.scopes = scopes;
    }
  }

  return Object.keys(auth).length > 0 ? auth : undefined;
}

export function inferMcpTransport(entry: Record<string, unknown>): "stdio" | "http" {
  const typeValue = entry.type ?? entry.transport;
  if (typeof typeValue === "string") {
    const normalized = typeValue.toLowerCase();
    if (
      normalized === "http" ||
      normalized === "remote" ||
      normalized === "sse" ||
      normalized === "streamable_http"
    ) {
      return "http";
    }
    if (normalized === "stdio") {
      return "stdio";
    }
  }

  if (entry.protocol === "sse") {
    return "http";
  }

  if (typeof entry.url === "string" || typeof entry.uri === "string") {
    return "http";
  }

  return "stdio";
}

export function parseMcpServerEntry(entry: unknown): McpServerMetadata | null {
  if (!isRecord(entry)) {
    return null;
  }

  const transport = inferMcpTransport(entry);

  let command: string | undefined;
  let args: string[] | undefined;
  const rawCommand = entry.command ?? entry.cmd;
  if (Array.isArray(rawCommand)) {
    command = typeof rawCommand[0] === "string" ? rawCommand[0] : undefined;
    args = rawCommand.slice(1).filter((arg): arg is string => typeof arg === "string");
  } else if (typeof rawCommand === "string") {
    command = rawCommand;
  }

  if (Array.isArray(entry.args)) {
    args = entry.args.filter((arg): arg is string => typeof arg === "string");
  }

  const url =
    typeof entry.url === "string"
      ? entry.url
      : typeof entry.uri === "string"
        ? entry.uri
        : undefined;

  const env = parseStringRecord(entry.env ?? entry.envs ?? entry.environment);
  const headers = parseStringRecord(entry.headers);
  const auth = parseAuthMetadata(entry.auth);
  const connection_type = typeof entry.type === "string" ? entry.type : undefined;
  const env_file =
    typeof entry.envFile === "string"
      ? entry.envFile
      : typeof entry.env_file === "string"
        ? entry.env_file
        : undefined;

  return {
    transport,
    ...(command !== undefined ? { command } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(args !== undefined && args.length > 0 ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(connection_type !== undefined ? { connection_type } : {}),
    ...(env_file !== undefined ? { env_file } : {}),
    ...(auth !== undefined ? { auth } : {}),
  };
}

export function parseMcpServersDocument(document: unknown): Record<string, McpServerMetadata> {
  if (!isRecord(document)) {
    return {};
  }

  const serversRaw = document.mcpServers ?? document.mcp_servers ?? document.mcp;
  if (!isRecord(serversRaw)) {
    return {};
  }

  const result: Record<string, McpServerMetadata> = {};
  for (const [name, serverEntry] of Object.entries(serversRaw)) {
    const metadata = parseMcpServerEntry(serverEntry);
    if (metadata) {
      result[name] = metadata;
    }
  }
  return result;
}

export function substituteMcpServerMetadata(
  metadata: McpServerMetadata,
  vars: Record<string, string>,
): { metadata: McpServerMetadata; missing: string[] } {
  const missing = new Set<string>();

  const substituteString = (template: string | undefined): string | undefined => {
    if (template === undefined) {
      return undefined;
    }
    const substituted = substituteEnvironmentVars(template, vars);
    for (const key of substituted.missing) {
      missing.add(key);
    }
    return substituted.value;
  };

  const command = substituteString(metadata.command);

  let args = metadata.args;
  if (args !== undefined) {
    args = args.map((arg) => {
      const substituted = substituteEnvironmentVars(arg, vars);
      for (const key of substituted.missing) {
        missing.add(key);
      }
      return substituted.value;
    });
  }

  const url = substituteString(metadata.url);

  let env = metadata.env;
  if (env !== undefined) {
    env = Object.fromEntries(
      Object.entries(env).map(([envKey, envValue]) => {
        const substituted = substituteEnvironmentVars(envValue, vars);
        for (const key of substituted.missing) {
          missing.add(key);
        }
        return [envKey, substituted.value];
      }),
    );
  }

  let headers = metadata.headers;
  if (headers !== undefined) {
    headers = Object.fromEntries(
      Object.entries(headers).map(([headerKey, headerValue]) => {
        const substituted = substituteEnvironmentVars(headerValue, vars);
        for (const key of substituted.missing) {
          missing.add(key);
        }
        return [headerKey, substituted.value];
      }),
    );
  }

  let auth = metadata.auth;
  if (auth !== undefined) {
    const clientId = substituteString(auth.CLIENT_ID);
    const clientSecret = substituteString(auth.CLIENT_SECRET);
    auth = {
      ...(clientId !== undefined ? { CLIENT_ID: clientId } : {}),
      ...(clientSecret !== undefined ? { CLIENT_SECRET: clientSecret } : {}),
      ...(auth.scopes !== undefined ? { scopes: auth.scopes } : {}),
    };
  }

  return {
    metadata: {
      ...metadata,
      ...(command !== undefined ? { command } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(headers !== undefined ? { headers } : {}),
      ...(auth !== undefined ? { auth } : {}),
    },
    missing: uniqueSorted(missing),
  };
}

export function emitCursorMcpServerEntry(
  metadata: McpServerMetadata,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (metadata.transport === "http" || metadata.url) {
    if (metadata.url !== undefined) {
      entry.url = metadata.url;
    }
    if (metadata.headers !== undefined && Object.keys(metadata.headers).length > 0) {
      entry.headers = metadata.headers;
    }
    if (metadata.auth !== undefined) {
      const auth: Record<string, unknown> = {};
      if (metadata.auth.CLIENT_ID !== undefined) {
        auth.CLIENT_ID = metadata.auth.CLIENT_ID;
      }
      if (metadata.auth.CLIENT_SECRET !== undefined) {
        auth.CLIENT_SECRET = metadata.auth.CLIENT_SECRET;
      }
      if (metadata.auth.scopes !== undefined && metadata.auth.scopes.length > 0) {
        auth.scopes = metadata.auth.scopes;
      }
      if (Object.keys(auth).length > 0) {
        entry.auth = auth;
      }
    }
    return entry;
  }

  entry.type = "stdio";
  if (metadata.command !== undefined) {
    entry.command = metadata.command;
  }
  if (metadata.args !== undefined && metadata.args.length > 0) {
    entry.args = metadata.args;
  }
  if (metadata.env !== undefined && Object.keys(metadata.env).length > 0) {
    entry.env = metadata.env;
  }
  if (metadata.env_file !== undefined) {
    entry.envFile = metadata.env_file;
  }

  return entry;
}
