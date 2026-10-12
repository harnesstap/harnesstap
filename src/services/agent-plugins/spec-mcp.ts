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
}

export interface SpecMcpOptions {
  /** Extra metadata fields to keep in the extension file when present. */
  carry?: ReadonlyArray<keyof McpServerMetadata>;
}

function nonEmpty(record: Record<string, string> | undefined): boolean {
  return record !== undefined && Object.keys(record).length > 0;
}

function specRemoteType(meta: McpServerMetadata): "streamable-http" | "sse" {
  return meta.connection_type?.toLowerCase() === "sse" ? "sse" : "streamable-http";
}

function toSpecEntry(
  meta: McpServerMetadata,
  options: SpecMcpOptions | undefined,
): { entry?: SpecMcpEntry; extra: Record<string, unknown> } {
  const extra: Record<string, unknown> = {};
  let entry: SpecMcpEntry | undefined;

  if (meta.transport === "http" && meta.url) {
    const type = specRemoteType(meta);
    entry = { type, url: meta.url };
    if (nonEmpty(meta.headers)) entry.headers = meta.headers;
    if (nonEmpty(meta.env)) extra.env = meta.env;
    // Import keeps only an exact `sse` from a spec `type`; stash anything else.
    if (meta.connection_type !== undefined && meta.connection_type !== "sse") {
      extra.connection_type = meta.connection_type;
    }
  } else if (meta.command) {
    entry = { type: "stdio", command: meta.command };
    if (meta.args) entry.args = meta.args;
    const env: Record<string, string> = {};
    const reserved: Record<string, string> = {};
    for (const [key, value] of Object.entries(meta.env ?? {})) {
      (RESERVED_ENV_NAMES.has(key) ? reserved : env)[key] = value;
    }
    if (nonEmpty(env)) entry.env = env;
    if (nonEmpty(reserved)) extra.env = reserved;
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
  return { ...(entry ? { entry } : {}), extra };
}

/** Build a spec-valid `mcp.json` plus the HarnessTap-only remainder. */
export function buildSpecMcpJson(
  servers: Record<string, McpServerMetadata>,
  options?: SpecMcpOptions,
): SpecMcpBuild {
  const mcpServers: Record<string, SpecMcpEntry> = {};
  const extras: Record<string, Record<string, unknown>> = {};
  for (const name of Object.keys(servers).sort()) {
    const meta = servers[name];
    if (!meta) continue;
    const { entry, extra } = toSpecEntry(meta, options);
    if (entry) mcpServers[name] = entry;
    if (Object.keys(extra).length > 0) extras[name] = extra;
  }
  return { document: { $schema: AP_MCP_SCHEMA_URL, mcpServers }, extras };
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
      if (key === "env" && isRecord(value)) {
        merged.env = { ...(isRecord(merged.env) ? merged.env : {}), ...value };
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
