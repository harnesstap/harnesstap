import { lstatSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import type { McpServerMetadata } from "../../types.js";
import { AP_MCP_SCHEMA_URL } from "./schema-registry.js";

/**
 * Agent Plugins 1.0.0 `mcp.json` loader (spec §7.2).
 *
 * A bad document disables MCP for the plugin. A bad server is skipped.
 * Other servers stay. Nothing here launches a process.
 */

const RESERVED_ENV = new Set(["PLUGIN_ROOT", "PLUGIN_DATA"]);
const STDIO_FIELDS = new Set(["type", "command", "args", "env", "cwd"]);
const REMOTE_FIELDS = new Set(["type", "url", "headers"]);
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CWD_RELATIVE = /^\.\/(.*)$/s;
const CWD_ROOT = /^\$\{PLUGIN_ROOT\}(?:\/(.*))?$/s;
const CWD_DATA = /^\$\{PLUGIN_DATA\}(?:\/(.*))?$/s;

export interface SpecMcpSkipped {
  name: string;
  reason: string;
}

export interface ParsedSpecMcpServer {
  name: string;
  metadata: McpServerMetadata;
}

export interface SpecMcpParse {
  /** Set when the whole file is unusable. Servers are empty in that case. */
  disabled?: string;
  servers: ParsedSpecMcpServer[];
  skipped: SpecMcpSkipped[];
}

export interface ParseSpecMcpOptions {
  /** Plugin root, so command and cwd symlinks can be checked. */
  root?: string;
  /** Canonical mcp.json `$schema` the plugin.json version requires. */
  expectedSchema?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lexicalInside(relativePath: string): boolean {
  let depth = 0;
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) return false;
      continue;
    }
    depth += 1;
  }
  return true;
}

function insideRoot(rootReal: string, candidate: string): boolean {
  const rel = relative(rootReal, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function windowsAbsolute(target: string): boolean {
  return win32.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target);
}

/** True when `start` resolves outside `rootReal` after following symlinks. */
function escapesRoot(rootReal: string, start: string): boolean {
  let current = resolve(start);
  const seen = new Set<string>();
  for (let hop = 0; hop < 16; hop += 1) {
    if (seen.has(current)) return true;
    seen.add(current);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(current);
    } catch {
      return !insideRoot(rootReal, current);
    }
    if (!stat.isSymbolicLink()) return !insideRoot(rootReal, current);
    let target: string;
    try {
      target = readlinkSync(current);
    } catch {
      return true;
    }
    if (isAbsolute(target)) return !insideRoot(rootReal, target);
    if (windowsAbsolute(target)) return true;
    current = resolve(dirname(current), target);
  }
  return true;
}

function cwdProblem(cwd: string, root: string | undefined): string | undefined {
  const relativeForm = CWD_RELATIVE.exec(cwd);
  const rootForm = CWD_ROOT.exec(cwd);
  const dataForm = CWD_DATA.exec(cwd);
  const rest = relativeForm?.[1] ?? rootForm?.[1] ?? dataForm?.[1];
  if (!relativeForm && !rootForm && !dataForm) {
    return `cwd "${cwd}" is not plugin-relative or a PLUGIN_ROOT or PLUGIN_DATA path`;
  }
  const suffix = rest ?? "";
  if (!lexicalInside(suffix)) {
    return `cwd "${cwd}" resolves outside its root`;
  }
  if (root && (relativeForm || rootForm)) {
    const absolute = suffix.length === 0 ? root : resolve(root, suffix);
    if (escapesRoot(root, absolute)) {
      return `cwd "${cwd}" resolves outside the plugin root`;
    }
  }
  return undefined;
}

function commandProblem(command: string, root: string | undefined): string | undefined {
  if (command.length === 0 || command.includes("\0") || command.includes("\n")) {
    return "command must be a single executable token";
  }
  if (command.startsWith("./")) {
    const relativePath = command.slice(2);
    if (relativePath.length === 0 || !lexicalInside(relativePath)) {
      return `command "${command}" escapes the plugin root`;
    }
    if (root) {
      const absolute = resolve(root, relativePath);
      if (escapesRoot(root, absolute)) {
        return `command "${command}" resolves outside the plugin root`;
      }
    }
    return undefined;
  }
  if (
    command === "." ||
    command === ".." ||
    command.startsWith("/") ||
    command.startsWith("../") ||
    command.includes("/") ||
    command.includes("\\") ||
    /\s/.test(command) ||
    windowsAbsolute(command)
  ) {
    return `command "${command}" must be a bare name or a plugin-relative path starting with ./`;
  }
  return undefined;
}

function headerProblem(headers: unknown): string | undefined {
  if (!isRecord(headers)) return "headers must be an object of strings";
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) return `header name "${name}" is not a valid HTTP header name`;
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      return `header "${name}" has an invalid value`;
    }
    const folded = name.toLowerCase();
    if (seen.has(folded)) return `header "${name}" is repeated under a different casing`;
    seen.add(folded);
  }
  return undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const parts = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part > 255)) return false;
  return parts[0] === 127;
}

function urlProblem(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "url must be an absolute http or https URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "url must be an absolute http or https URL";
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return "url must not contain user info";
  }
  if (url.hash.length > 0) return "url must not contain a fragment";
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return "non-loopback url must use https";
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  return value;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return undefined;
    record[key] = entry;
  }
  return record;
}

function unknownField(entry: Record<string, unknown>, allowed: Set<string>): string | undefined {
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) return `unknown field "${key}"`;
  }
  return undefined;
}

function parseServer(
  _name: string,
  entry: unknown,
  root: string | undefined,
): { metadata?: McpServerMetadata; reason?: string } {
  if (!isRecord(entry)) return { reason: "server entry must be an object" };
  const type = entry.type;
  if (type !== "stdio" && type !== "streamable-http" && type !== "sse") {
    return { reason: "type must be stdio, streamable-http, or sse" };
  }
  if (type === "stdio") {
    const unknown = unknownField(entry, STDIO_FIELDS);
    if (unknown) return { reason: unknown };
    if (typeof entry.command !== "string") return { reason: "stdio command is required" };
    const commandError = commandProblem(entry.command, root);
    if (commandError) return { reason: commandError };
    let args: string[] | undefined;
    if (entry.args !== undefined) {
      args = stringArray(entry.args);
      if (!args) return { reason: "args must be an array of strings" };
    }
    let env: Record<string, string> | undefined;
    if (entry.env !== undefined) {
      env = stringRecord(entry.env);
      if (!env) return { reason: "env must be an object of strings" };
      for (const key of Object.keys(env)) {
        if (RESERVED_ENV.has(key)) {
          return { reason: `env must not set reserved name ${key}` };
        }
      }
    }
    let cwd: string | undefined;
    if (entry.cwd !== undefined) {
      if (typeof entry.cwd !== "string") return { reason: "cwd must be a string" };
      const cwdError = cwdProblem(entry.cwd, root);
      if (cwdError) return { reason: cwdError };
      cwd = entry.cwd;
    }
    const metadata: McpServerMetadata = {
      transport: "stdio",
      command: entry.command,
      ...(args && args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    };
    if (cwd !== undefined) {
      (metadata as McpServerMetadata & { cwd?: string }).cwd = cwd;
    }
    return { metadata };
  }

  const unknown = unknownField(entry, REMOTE_FIELDS);
  if (unknown) return { reason: unknown };
  if (typeof entry.url !== "string" || entry.url.length === 0) return { reason: "url is required" };
  const urlError = urlProblem(entry.url);
  if (urlError) return { reason: urlError };
  let headers: Record<string, string> | undefined;
  if (entry.headers !== undefined) {
    const headerError = headerProblem(entry.headers);
    if (headerError) return { reason: headerError };
    headers = stringRecord(entry.headers);
  }
  const metadata: McpServerMetadata = {
    transport: "http",
    url: entry.url,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    ...(type === "sse" ? { connection_type: "sse" } : {}),
  };
  return { metadata };
}

export function parseSpecMcpJson(document: unknown, options?: ParseSpecMcpOptions): SpecMcpParse {
  const expected = options?.expectedSchema ?? AP_MCP_SCHEMA_URL;
  if (!isRecord(document)) {
    return { disabled: "mcp.json must be a JSON object", servers: [], skipped: [] };
  }
  for (const key of Object.keys(document)) {
    if (key !== "$schema" && key !== "mcpServers") {
      return {
        disabled: `mcp.json has unknown top-level field "${key}"`,
        servers: [],
        skipped: [],
      };
    }
  }
  if (document.$schema !== expected) {
    return {
      disabled: `mcp.json $schema ${String(document.$schema)} does not match ${expected}`,
      servers: [],
      skipped: [],
    };
  }
  if (!isRecord(document.mcpServers)) {
    return { disabled: "mcp.json mcpServers must be an object", servers: [], skipped: [] };
  }

  const servers: ParsedSpecMcpServer[] = [];
  const skipped: SpecMcpSkipped[] = [];
  for (const [name, entry] of Object.entries(document.mcpServers)) {
    const parsed = parseServer(name, entry, options?.root);
    if (parsed.metadata) servers.push({ name, metadata: parsed.metadata });
    else skipped.push({ name, reason: parsed.reason ?? "invalid server" });
  }
  return { servers, skipped };
}
