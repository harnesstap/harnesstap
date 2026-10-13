import type { McpServerMetadata } from "../../types.js";
import { parseMcpServersDocument } from "../mcp-config-bridge.js";
import { formatTransportToml } from "../toml/write.js";
import { HT_EXTENSION_NAMESPACE, HT_EXTENSION_SCHEMA } from "./manifest.js";
import { AP_MCP_SCHEMA_URL } from "./schema-registry.js";

/**
 * Agent Plugins 1.0.0 `mcp.json` (spec §7.2.1): a closed union of
 * `stdio` (`command`, `args`, `env`, `cwd`), `streamable-http` and `sse`
 * (`url`, `headers`), each with an explicit `type`.
 *
 * Server data the spec shape cannot carry (env on a remote server, the
 * reserved `PLUGIN_ROOT` / `PLUGIN_DATA` env names, a harness-specific
 * connection type, or a server with neither command nor url) is kept in
 * `com.harnesstap/mcp.toml`, so HarnessTap re-import restores it and other
 * clients ignore it. Nothing is dropped.
 */

export const HT_MCP_EXTRAS_PATH = `${HT_EXTENSION_NAMESPACE}/mcp.toml`;

/** Env names the spec reserves for the client (`${PLUGIN_ROOT}`, `${PLUGIN_DATA}`). */
const RESERVED_ENV_NAMES = new Set(["PLUGIN_ROOT", "PLUGIN_DATA"]);

export type SpecMcpEntry = Record<string, unknown>;

export interface SpecMcpDocument {
  $schema: string;
  mcpServers: Record<string, SpecMcpEntry>;
}

export interface SpecMcpBuild {
  document: SpecMcpDocument;
  /** Per-server fields kept only in `com.harnesstap/mcp.toml`. */
  extras: Record<string, Record<string, unknown>>;
  /** Secret-like env and header values moved into the extension. */
  warnings: string[];
}

export interface SpecMcpOptions {
  /** Extra metadata fields to keep in the extension file when present. */
  carry?: ReadonlyArray<keyof McpServerMetadata>;
}

function nonEmpty(record: Record<string, string> | undefined): boolean {
  return record !== undefined && Object.keys(record).length > 0;
}

const SECRET_KEY = /(?:^|_)(?:TOKEN|SECRET|KEY|PASSWORD)$/i;
const SECRET_HEADER = /^(?:authorization|proxy-authorization|x-api-key|api-key)$/i;
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** True when a value uses a placeholder other than the two spec plugin variables. */
export function hasForeignPlaceholder(value: string): boolean {
  for (const match of value.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name && name !== "PLUGIN_ROOT" && name !== "PLUGIN_DATA") return true;
  }
  return false;
}

function isSecretLike(key: string, value: string, kind: "env" | "header"): boolean {
  if (hasForeignPlaceholder(value)) return true;
  if (kind === "header" && SECRET_HEADER.test(key)) return true;
  return SECRET_KEY.test(key);
}

function splitPortable(
  record: Record<string, string> | undefined,
  kind: "env" | "header",
): { portable: Record<string, string>; moved: Record<string, string> } {
  const portable: Record<string, string> = {};
  const moved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (kind === "env" && RESERVED_ENV_NAMES.has(key)) {
      moved[key] = value;
      continue;
    }
    if (isSecretLike(key, value, kind)) moved[key] = value;
    else portable[key] = value;
  }
  return { portable, moved };
}

function specRemoteType(meta: McpServerMetadata): "streamable-http" | "sse" {
  if (meta.http_transport === "sse" || meta.http_transport === "streamable-http") {
    return meta.http_transport;
  }
  return meta.connection_type?.toLowerCase() === "sse" ? "sse" : "streamable-http";
}

function toSpecEntry(
  meta: McpServerMetadata,
  options: SpecMcpOptions | undefined,
): { entry?: SpecMcpEntry; extra: Record<string, unknown>; movedSecret: boolean } {
  const extra: Record<string, unknown> = {};
  let entry: SpecMcpEntry | undefined;
  let movedSecret = false;

  if (meta.transport === "http" && meta.url) {
    const type = specRemoteType(meta);
    entry = { type, url: meta.url };
    const headers = splitPortable(meta.headers, "header");
    if (nonEmpty(headers.portable)) entry.headers = headers.portable;
    if (nonEmpty(headers.moved)) {
      extra.headers = headers.moved;
      movedSecret = true;
    }
    const env = splitPortable(meta.env, "env");
    if (nonEmpty(env.portable) || nonEmpty(env.moved)) {
      extra.env = { ...env.moved, ...env.portable };
    }
    if (nonEmpty(env.moved)) movedSecret = true;
    // Import keeps only an exact `sse` from a spec `type`; stash anything else.
    if (meta.connection_type !== undefined && meta.connection_type !== "sse") {
      extra.connection_type = meta.connection_type;
    }
  } else if (meta.command) {
    entry = { type: "stdio", command: meta.command };
    if (meta.args) entry.args = meta.args;
    if (meta.cwd) entry.cwd = meta.cwd;
    const env = splitPortable(meta.env, "env");
    if (nonEmpty(env.portable)) entry.env = env.portable;
    if (nonEmpty(env.moved)) {
      extra.env = env.moved;
      if (Object.keys(env.moved).some((key) => !RESERVED_ENV_NAMES.has(key))) {
        movedSecret = true;
      }
    }
    if (meta.transport !== "stdio") extra.transport = meta.transport;
    if (meta.connection_type !== undefined) extra.connection_type = meta.connection_type;
  } else {
    // Neither a launchable command nor a URL: not expressible in mcp.json.
    extra.transport = meta.transport;
    if (meta.url !== undefined) extra.url = meta.url;
    if (meta.args) extra.args = meta.args;
    if (nonEmpty(meta.env)) extra.env = meta.env;
    if (nonEmpty(meta.headers)) extra.headers = meta.headers;
    if (meta.connection_type !== undefined) extra.connection_type = meta.connection_type;
  }

  for (const key of options?.carry ?? []) {
    const value = meta[key];
    if (value !== undefined && extra[key] === undefined) extra[key] = value;
  }
  return { ...(entry ? { entry } : {}), extra, movedSecret };
}

/** Build a spec-valid `mcp.json` plus the HarnessTap-only remainder. */
export function buildSpecMcpJson(
  servers: Record<string, McpServerMetadata>,
  options?: SpecMcpOptions,
): SpecMcpBuild {
  const mcpServers: Record<string, SpecMcpEntry> = {};
  const extras: Record<string, Record<string, unknown>> = {};
  const warnings: string[] = [];
  for (const name of Object.keys(servers).sort()) {
    const meta = servers[name];
    if (!meta) continue;
    const { entry, extra, movedSecret } = toSpecEntry(meta, options);
    if (entry) mcpServers[name] = entry;
    if (Object.keys(extra).length > 0) extras[name] = extra;
    if (movedSecret) {
      warnings.push(
        `MCP server "${name}": moved secret-like env or header values to com.harnesstap; other Agent Plugins clients need setup outside HarnessTap`,
      );
    }
  }
  return { document: { $schema: AP_MCP_SCHEMA_URL, mcpServers }, extras, warnings };
}

export function formatSpecMcpJson(document: SpecMcpDocument): string {
  return JSON.stringify(document, null, 2);
}

export function formatMcpExtrasToml(extras: Record<string, Record<string, unknown>>): string {
  return formatTransportToml({ schema: HT_EXTENSION_SCHEMA, servers: extras });
}

export function isSpecMcpDocument(document: unknown): boolean {
  return (
    typeof document === "object" &&
    document !== null &&
    !Array.isArray(document) &&
    (document as Record<string, unknown>).$schema === AP_MCP_SCHEMA_URL
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read `mcp.json` (spec or legacy shape) plus optional
 * `com.harnesstap/mcp.toml` extras into HarnessTap metadata.
 */
export function readApMcpServers(
  document: unknown,
  extrasDocument: Record<string, unknown> | undefined,
): Record<string, McpServerMetadata> {
  // parseMcpServersDocument already reads a spec `type` as the transport only.
  const servers = parseMcpServersDocument(document);
  const extras = isRecord(extrasDocument?.servers) ? extrasDocument.servers : {};
  for (const [name, rawExtra] of Object.entries(extras)) {
    if (!isRecord(rawExtra)) continue;
    const base = servers[name];
    const merged: Record<string, unknown> = { ...(base ?? {}) };
    for (const [key, value] of Object.entries(rawExtra)) {
      if ((key === "env" || key === "headers") && isRecord(value)) {
        const prior = merged[key];
        merged[key] = { ...(isRecord(prior) ? prior : {}), ...value };
      } else {
        merged[key] = value;
      }
    }
    if (merged.transport !== "stdio" && merged.transport !== "http") {
      merged.transport = typeof merged.url === "string" ? "http" : "stdio";
    }
    servers[name] = merged as unknown as McpServerMetadata;
  }
  return servers;
}
