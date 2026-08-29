import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";

export const DEFAULT_MCP_REGISTRY_URL = "https://registry.modelcontextprotocol.io";

export class McpRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpRegistryError";
  }
}

export interface McpRegistryArgumentVariable {
  description?: string;
  format?: string;
  isRequired?: boolean;
  default?: string;
  isSecret?: boolean;
}

export interface McpRegistryArgument {
  type?: string;
  name?: string;
  value?: string;
  valueHint?: string;
  description?: string;
  isRequired?: boolean;
  default?: string;
  variables?: Record<string, McpRegistryArgumentVariable>;
}

export interface McpRegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface McpRegistryTransport {
  type?: string;
  url?: string;
  headers?: Array<{ name: string; value?: string; isSecret?: boolean; description?: string }>;
}

export interface McpRegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: McpRegistryTransport;
  runtimeArguments?: McpRegistryArgument[];
  packageArguments?: McpRegistryArgument[];
  environmentVariables?: McpRegistryEnvVar[];
}

export interface McpRegistryRemote {
  type?: string;
  url?: string;
  headers?: Array<{ name: string; value?: string; isSecret?: boolean; description?: string }>;
}

export interface McpRegistryServer {
  name: string;
  description?: string;
  title?: string;
  version?: string;
  packages?: McpRegistryPackage[];
  remotes?: McpRegistryRemote[];
}

export interface McpRegistryServerHit {
  server: McpRegistryServer;
}

export interface McpRegistryListResult {
  servers: McpRegistryServerHit[];
  nextCursor?: string;
  count?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseVariables(value: unknown): Record<string, McpRegistryArgumentVariable> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, McpRegistryArgumentVariable> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    result[key] = {
      ...(stringField(entry.description) ? { description: stringField(entry.description) } : {}),
      ...(stringField(entry.format) ? { format: stringField(entry.format) } : {}),
      ...(boolField(entry.isRequired) !== undefined ? { isRequired: boolField(entry.isRequired) } : {}),
      ...(stringField(entry.default) ? { default: stringField(entry.default) } : {}),
      ...(boolField(entry.isSecret) !== undefined ? { isSecret: boolField(entry.isSecret) } : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseArgument(value: unknown): McpRegistryArgument | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const variables = parseVariables(value.variables);
  const valueHint = stringField(value.valueHint) ?? stringField(value.value_hint);
  const isRequired = boolField(value.isRequired) ?? boolField(value.is_required);
  return {
    ...(stringField(value.type) ? { type: stringField(value.type) } : {}),
    ...(stringField(value.name) ? { name: stringField(value.name) } : {}),
    ...(stringField(value.value) ? { value: stringField(value.value) } : {}),
    ...(valueHint ? { valueHint } : {}),
    ...(stringField(value.description) ? { description: stringField(value.description) } : {}),
    ...(isRequired !== undefined ? { isRequired } : {}),
    ...(stringField(value.default) ? { default: stringField(value.default) } : {}),
    ...(variables ? { variables } : {}),
  };
}

function parseArgumentList(value: unknown): McpRegistryArgument[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const args = value
    .map(parseArgument)
    .filter((entry): entry is McpRegistryArgument => entry !== undefined);
  return args.length > 0 ? args : undefined;
}

function parseHeaders(
  value: unknown,
): Array<{ name: string; value?: string; isSecret?: boolean; description?: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const headers: Array<{ name: string; value?: string; isSecret?: boolean; description?: string }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = stringField(entry.name);
    if (!name) {
      continue;
    }
    headers.push({
      name,
      ...(stringField(entry.value) ? { value: stringField(entry.value) } : {}),
      ...(boolField(entry.isSecret) !== undefined ? { isSecret: boolField(entry.isSecret) } : {}),
      ...(stringField(entry.description) ? { description: stringField(entry.description) } : {}),
    });
  }
  return headers.length > 0 ? headers : undefined;
}

function parseTransport(value: unknown): McpRegistryTransport | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const headers = parseHeaders(value.headers);
  return {
    ...(stringField(value.type) ? { type: stringField(value.type) } : {}),
    ...(stringField(value.url) ? { url: stringField(value.url) } : {}),
    ...(headers ? { headers } : {}),
  };
}

function parseEnvVars(value: unknown): McpRegistryEnvVar[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const vars: McpRegistryEnvVar[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = stringField(entry.name);
    if (!name) {
      continue;
    }
    vars.push({
      name,
      ...(stringField(entry.description) ? { description: stringField(entry.description) } : {}),
      ...(boolField(entry.isRequired) !== undefined ? { isRequired: boolField(entry.isRequired) } : {}),
      ...(boolField(entry.isSecret) !== undefined ? { isSecret: boolField(entry.isSecret) } : {}),
      ...(stringField(entry.default) ? { default: stringField(entry.default) } : {}),
    });
  }
  return vars.length > 0 ? vars : undefined;
}

function parsePackage(value: unknown): McpRegistryPackage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const identifier = stringField(value.identifier);
  if (!identifier) {
    return undefined;
  }
  const runtimeArguments = parseArgumentList(value.runtimeArguments);
  const packageArguments = parseArgumentList(value.packageArguments);
  const environmentVariables = parseEnvVars(value.environmentVariables);
  const transport = parseTransport(value.transport);
  return {
    identifier,
    ...(stringField(value.registryType) ? { registryType: stringField(value.registryType) } : {}),
    ...(stringField(value.version) ? { version: stringField(value.version) } : {}),
    ...(stringField(value.runtimeHint) ? { runtimeHint: stringField(value.runtimeHint) } : {}),
    ...(transport ? { transport } : {}),
    ...(runtimeArguments ? { runtimeArguments } : {}),
    ...(packageArguments ? { packageArguments } : {}),
    ...(environmentVariables ? { environmentVariables } : {}),
  };
}

function parseRemote(value: unknown): McpRegistryRemote | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const url = stringField(value.url);
  if (!url) {
    return undefined;
  }
  const headers = parseHeaders(value.headers);
  return {
    url,
    ...(stringField(value.type) ? { type: stringField(value.type) } : {}),
    ...(headers ? { headers } : {}),
  };
}

export function parseMcpRegistryServer(value: unknown): McpRegistryServer | null {
  const record = isRecord(value) && isRecord(value.server) ? value.server : value;
  if (!isRecord(record)) {
    return null;
  }
  const name = stringField(record.name);
  if (!name) {
    return null;
  }
  const packages = Array.isArray(record.packages)
    ? record.packages
        .map(parsePackage)
        .filter((entry): entry is McpRegistryPackage => entry !== undefined)
    : undefined;
  const remotes = Array.isArray(record.remotes)
    ? record.remotes
        .map(parseRemote)
        .filter((entry): entry is McpRegistryRemote => entry !== undefined)
    : undefined;
  return {
    name,
    ...(stringField(record.description) ? { description: stringField(record.description) } : {}),
    ...(stringField(record.title) ? { title: stringField(record.title) } : {}),
    ...(stringField(record.version) ? { version: stringField(record.version) } : {}),
    ...(packages && packages.length > 0 ? { packages } : {}),
    ...(remotes && remotes.length > 0 ? { remotes } : {}),
  };
}

export function mcpRegistryBaseUrl(): string {
  const override = process.env.HARNESSTAP_MCP_REGISTRY_URL?.trim();
  return (override && override.length > 0 ? override : DEFAULT_MCP_REGISTRY_URL).replace(/\/$/, "");
}

export function splitMcpRegistryIdentity(raw: string): { name: string; version: string } {
  const trimmed = raw.trim();
  const slash = trimmed.lastIndexOf("/");
  const at = trimmed.lastIndexOf("@");
  if (at > slash && at > 0) {
    const name = trimmed.slice(0, at);
    const version = trimmed.slice(at + 1);
    if (name && version) {
      return { name, version };
    }
  }
  return { name: trimmed, version: "latest" };
}

function encodeServerName(name: string): string {
  return encodeURIComponent(name);
}

async function registryGet(path: string): Promise<unknown> {
  const url = `${mcpRegistryBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "harnesstap",
      },
    });
  } catch (error) {
    throw new McpRegistryError(
      error instanceof Error ? error.message : `MCP registry request failed: ${url}`,
    );
  }
  if (response.status === 404) {
    throw new McpRegistryError(`MCP registry server not found (${url})`);
  }
  if (!response.ok) {
    throw new McpRegistryError(
      `MCP registry request failed (${response.status} ${response.statusText}): ${url}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new McpRegistryError(`MCP registry returned invalid JSON: ${url}`);
  }
}

export async function fetchMcpRegistryServer(identity: string): Promise<McpRegistryServer> {
  const { name, version } = splitMcpRegistryIdentity(identity);
  const payload = await registryGet(
    `/v0.1/servers/${encodeServerName(name)}/versions/${encodeURIComponent(version)}`,
  );
  const server = parseMcpRegistryServer(payload);
  if (!server) {
    throw new McpRegistryError(`MCP registry returned an unusable server document for ${identity}`);
  }
  return server;
}

export async function searchMcpRegistryServers(
  query: string,
  options: { limit?: number } = {},
): Promise<McpRegistryListResult> {
  const limit = options.limit ?? 20;
  const params = new URLSearchParams({
    search: query,
    version: "latest",
    limit: String(limit),
  });
  return parseListPayload(await registryGet(`/v0.1/servers?${params.toString()}`));
}

export async function listMcpRegistryServers(
  options: { limit?: number; cursor?: string } = {},
): Promise<McpRegistryListResult> {
  const params = new URLSearchParams({
    version: "latest",
    limit: String(options.limit ?? 20),
  });
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  return parseListPayload(await registryGet(`/v0.1/servers?${params.toString()}`));
}

function parseListPayload(payload: unknown): McpRegistryListResult {
  if (!isRecord(payload) || !Array.isArray(payload.servers)) {
    throw new McpRegistryError("MCP registry list response is missing servers");
  }
  const servers: McpRegistryServerHit[] = [];
  for (const entry of payload.servers) {
    const server = parseMcpRegistryServer(entry);
    if (server) {
      servers.push({ server });
    }
  }
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  return {
    servers,
    ...(stringField(metadata.nextCursor) ? { nextCursor: stringField(metadata.nextCursor) } : {}),
    ...(typeof metadata.count === "number" ? { count: metadata.count } : {}),
  };
}
