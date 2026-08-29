import type { McpServerMetadata } from "../types.js";
import type { ParsedMcpDependency } from "./apm-dependencies.js";
import {
  fetchMcpRegistryServer,
  McpRegistryError,
  type McpRegistryArgument,
  type McpRegistryEnvVar,
  type McpRegistryPackage,
  type McpRegistryRemote,
  type McpRegistryServer,
} from "./mcp-registry.js";

const PACKAGE_PREFERENCE = ["npm", "oci", "pypi", "nuget"] as const;

export interface ResolvedMcpDependency extends ParsedMcpDependency {
  metadata: McpServerMetadata;
}

function envPlaceholder(name: string): string {
  return `\${${name}}`;
}

function substituteTemplate(
  template: string,
  variables: McpRegistryArgument["variables"],
): { value: string; omit: boolean } {
  const envEquals = template.match(/^([A-Z][A-Z0-9_]*)=\{[^}]+\}$/);
  if (envEquals?.[1]) {
    return { value: `${envEquals[1]}=${envPlaceholder(envEquals[1])}`, omit: false };
  }

  let omit = false;
  const value = template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
    const variable = variables?.[name];
    if (variable?.default && !variable.isSecret) {
      return variable.default;
    }
    if (variable?.isRequired === false && !variable.default) {
      omit = true;
      return "";
    }
    return envPlaceholder(name.toUpperCase());
  });
  return { value, omit };
}

function argumentTokens(arg: McpRegistryArgument): string[] | undefined {
  const required = arg.isRequired !== false;
  const template = arg.value ?? arg.valueHint ?? arg.default;
  if (!template) {
    if (!required) {
      return undefined;
    }
    if (arg.name && (arg.name.startsWith("-") || arg.type === "named")) {
      return [arg.name.startsWith("-") ? arg.name : `--${arg.name}`];
    }
    return undefined;
  }
  const resolved = substituteTemplate(template, arg.variables);
  if (resolved.omit && !required) {
    return undefined;
  }
  if (arg.type === "named" || (arg.name && arg.name.startsWith("-"))) {
    const flag = arg.name
      ? arg.name.startsWith("-")
        ? arg.name
        : `--${arg.name}`
      : undefined;
    if (!flag) {
      return [resolved.value];
    }
    return [flag, resolved.value];
  }
  return [resolved.value];
}

function flattenArguments(args: McpRegistryArgument[] | undefined): string[] {
  if (!args) {
    return [];
  }
  const tokens: string[] = [];
  for (const arg of args) {
    const next = argumentTokens(arg);
    if (next) {
      tokens.push(...next);
    }
  }
  return tokens;
}

function headerRecord(
  headers: Array<{ name: string; value?: string; isSecret?: boolean }> | undefined,
): Record<string, string> | undefined {
  if (!headers || headers.length === 0) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const header of headers) {
    if (header.value) {
      result[header.name] = substituteTemplate(header.value, undefined).value;
      continue;
    }
    const envName = header.name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
    result[header.name] = header.name.toLowerCase() === "authorization"
      ? `Bearer ${envPlaceholder(envName)}`
      : envPlaceholder(envName);
  }
  return result;
}

function envRecord(vars: McpRegistryEnvVar[] | undefined): Record<string, string> | undefined {
  if (!vars || vars.length === 0) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const entry of vars) {
    if (entry.isRequired === false && !entry.default && !entry.isSecret) {
      continue;
    }
    if (entry.isSecret || !entry.default) {
      result[entry.name] = envPlaceholder(entry.name);
      continue;
    }
    result[entry.name] = entry.default;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isRemoteTransport(type: string | undefined): boolean {
  if (!type) {
    return false;
  }
  const normalized = type.toLowerCase();
  return (
    normalized === "http"
    || normalized === "sse"
    || normalized === "streamable-http"
    || normalized === "streamable_http"
    || normalized === "remote"
  );
}

function metadataFromRemote(remote: McpRegistryRemote): McpServerMetadata {
  return {
    transport: "http",
    url: remote.url,
    ...(headerRecord(remote.headers) ? { headers: headerRecord(remote.headers) } : {}),
  };
}

function npmPackageRef(pkg: McpRegistryPackage): string {
  const identifier = pkg.identifier ?? "";
  if (!pkg.version || identifier.includes("@", 1)) {
    return identifier;
  }
  return `${identifier}@${pkg.version}`;
}

function ensureFlag(args: string[], flag: string): string[] {
  return args.includes(flag) ? args : [flag, ...args];
}

function metadataFromPackage(pkg: McpRegistryPackage): McpServerMetadata | null {
  const identifier = pkg.identifier;
  if (!identifier) {
    return null;
  }
  const transportType = pkg.transport?.type;
  if (isRemoteTransport(transportType) && pkg.transport?.url) {
    return {
      transport: "http",
      url: pkg.transport.url,
      ...(headerRecord(pkg.transport.headers) ? { headers: headerRecord(pkg.transport.headers) } : {}),
      ...(envRecord(pkg.environmentVariables) ? { env: envRecord(pkg.environmentVariables) } : {}),
    };
  }

  const runtimeArgs = flattenArguments(pkg.runtimeArguments);
  const packageArgs = flattenArguments(pkg.packageArguments);
  const registryType = (pkg.registryType ?? "").toLowerCase();
  const hint = pkg.runtimeHint?.trim();

  let command: string;
  let args: string[];
  switch (registryType) {
    case "npm": {
      command = hint && hint.length > 0 ? hint : "npx";
      const prefix = command === "npx" ? ensureFlag(runtimeArgs, "-y") : runtimeArgs;
      args = [...prefix, npmPackageRef(pkg), ...packageArgs];
      break;
    }
    case "oci": {
      command = hint && hint.length > 0 ? hint : "docker";
      const dockerArgs = command === "docker"
        ? ["run", ...ensureFlag(ensureFlag(runtimeArgs, "--rm"), "-i")]
        : runtimeArgs;
      args = [...dockerArgs, identifier, ...packageArgs];
      break;
    }
    case "pypi": {
      command = hint && hint.length > 0 ? hint : "uvx";
      args = [...runtimeArgs, npmPackageRef(pkg), ...packageArgs];
      break;
    }
    case "nuget": {
      command = hint && hint.length > 0 ? hint : "dnx";
      args = [...runtimeArgs, identifier, ...packageArgs];
      break;
    }
    default: {
      if (!hint) {
        return null;
      }
      command = hint;
      args = [...runtimeArgs, identifier, ...packageArgs];
      break;
    }
  }

  return {
    transport: "stdio",
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(envRecord(pkg.environmentVariables) ? { env: envRecord(pkg.environmentVariables) } : {}),
  };
}

function pickPackage(packages: McpRegistryPackage[] | undefined): McpRegistryPackage | undefined {
  if (!packages || packages.length === 0) {
    return undefined;
  }
  for (const preferred of PACKAGE_PREFERENCE) {
    const match = packages.find((entry) => (entry.registryType ?? "").toLowerCase() === preferred);
    if (match) {
      return match;
    }
  }
  return packages[0];
}

export function mcpMetadataFromRegistryServer(server: McpRegistryServer): McpServerMetadata {
  const remote = server.remotes?.[0];
  if (remote?.url) {
    return metadataFromRemote(remote);
  }
  const pkg = pickPackage(server.packages);
  const fromPackage = pkg ? metadataFromPackage(pkg) : null;
  if (!fromPackage) {
    throw new McpRegistryError(
      `MCP registry server ${server.name} has no usable remote or package (npm/oci/pypi/nuget)`,
    );
  }
  return fromPackage;
}

export function mcpDependencyNeedsRegistry(dep: ParsedMcpDependency): boolean {
  if (dep.selfDefined) {
    return false;
  }
  if (dep.command || dep.url) {
    return false;
  }
  return Boolean(dep.registryId);
}

function metadataFromInline(dep: ParsedMcpDependency): McpServerMetadata {
  const transport: McpServerMetadata["transport"] =
    dep.transport ?? (dep.url ? "http" : "stdio");
  return {
    transport,
    ...(dep.command ? { command: dep.command } : {}),
    ...(dep.args ? { args: dep.args } : {}),
    ...(dep.url ? { url: dep.url } : {}),
    ...(dep.env ? { env: dep.env } : {}),
    ...(dep.headers ? { headers: dep.headers } : {}),
  };
}

export async function resolveMcpDependencies(
  deps: ParsedMcpDependency[],
): Promise<ResolvedMcpDependency[]> {
  const resolved: ResolvedMcpDependency[] = [];
  for (const dep of deps) {
    if (!mcpDependencyNeedsRegistry(dep)) {
      resolved.push({ ...dep, metadata: metadataFromInline(dep) });
      continue;
    }
    const registryId = dep.registryId;
    if (!registryId) {
      throw new McpRegistryError(`MCP dependency ${dep.name} is missing a registry identity`);
    }
    const server = await fetchMcpRegistryServer(registryId);
    resolved.push({
      ...dep,
      metadata: mcpMetadataFromRegistryServer(server),
    });
  }
  return resolved;
}
