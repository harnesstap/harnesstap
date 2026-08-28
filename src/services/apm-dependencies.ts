export type ApmDependencySourceKind = "git" | "catalog" | "marketplace" | "local";

export interface ParsedApmDependency {
  raw: string;
  sourceKind: ApmDependencySourceKind;
  name: string;
  originRef: string;
  applySelector: string;
  ref?: string;
  versionConstraint?: string;
}

export interface ParsedMcpDependency {
  raw: string;
  name: string;
  registryId?: string;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  selfDefined: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function splitHashRef(value: string): { body: string; ref?: string } {
  const hash = value.lastIndexOf("#");
  if (hash <= 0) {
    return { body: value };
  }
  const body = value.slice(0, hash);
  const ref = value.slice(hash + 1);
  if (!body || !ref) {
    return { body: value };
  }
  return { body, ref };
}

function repoNameFromGitRef(value: string): string {
  const withoutGit = value.replace(/\.git$/, "");
  const tail = withoutGit.split("/").filter(Boolean).pop() ?? withoutGit;
  return tail.split(":").pop() ?? tail;
}

function looksLikeHost(segment: string): boolean {
  return segment.includes(".") || segment === "localhost";
}

function githubCloneUrl(ownerRepo: string): string {
  const trimmed = ownerRepo.replace(/\.git$/, "");
  return `https://github.com/${trimmed}.git`;
}

function parseGitShorthand(body: string, raw: string, ref?: string): ParsedApmDependency {
  const name = repoNameFromGitRef(body);
  const originRef = looksLikeHost(body.split("/")[0] ?? "")
    ? body
    : githubCloneUrl(body);
  return {
    raw,
    sourceKind: "git",
    name,
    originRef,
    applySelector: name,
    ...(ref ? { ref, versionConstraint: ref } : {}),
  };
}

export function parseApmDependencyString(entry: string): ParsedApmDependency {
  const trimmed = entry.trim();
  const { body, ref } = splitHashRef(trimmed);

  if (
    body.startsWith("./")
    || body.startsWith("../")
    || body.startsWith("~/")
    || body.startsWith("/")
    || body.startsWith(".\\")
    || body.startsWith("..\\")
    || body.startsWith("~\\")
  ) {
    const name = body.split(/[/\\]/).filter(Boolean).pop() ?? body;
    return {
      raw: trimmed,
      sourceKind: "local",
      name,
      originRef: body,
      applySelector: name,
    };
  }

  if (
    body.startsWith("https://")
    || body.startsWith("http://")
    || body.startsWith("git@")
    || body.startsWith("ssh://git@")
    || body.startsWith("git+")
  ) {
    const name = repoNameFromGitRef(body);
    return {
      raw: trimmed,
      sourceKind: "git",
      name,
      originRef: body,
      applySelector: name,
      ...(ref ? { ref, versionConstraint: ref } : {}),
    };
  }

  const slashParts = body.split("/").filter(Boolean);
  const at = body.lastIndexOf("@");

  if (slashParts.length === 3) {
    const namePart = slashParts[2] ?? body;
    const name = namePart.includes("@") ? (namePart.split("@")[0] ?? namePart) : namePart;
    return {
      raw: trimmed,
      sourceKind: "catalog",
      name,
      originRef: body,
      applySelector: body,
      ...(ref ? { ref, versionConstraint: ref } : {}),
    };
  }

  if (at > 0 && !body.slice(0, at).includes("/")) {
    const name = body.slice(0, at);
    return {
      raw: trimmed,
      sourceKind: "marketplace",
      name,
      originRef: body,
      applySelector: body,
    };
  }

  if (slashParts.length === 2) {
    return parseGitShorthand(body, trimmed, ref);
  }

  if (slashParts.length > 2 && looksLikeHost(slashParts[0] ?? "")) {
    return parseGitShorthand(body, trimmed, ref);
  }

  return {
    raw: trimmed,
    sourceKind: "local",
    name: body,
    originRef: body,
    applySelector: body,
    ...(ref ? { ref, versionConstraint: ref } : {}),
  };
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = String(entry);
  }
  return result;
}

export function parseApmDependencyEntry(entry: unknown): ParsedApmDependency {
  if (typeof entry === "string") {
    return parseApmDependencyString(entry);
  }
  if (!isRecord(entry)) {
    throw new Error("dependencies.apm entries must be strings or mappings");
  }

  if (typeof entry.git === "string" && typeof entry.id === "string") {
    throw new Error("dependencies.apm object cannot set both git and id");
  }

  if (typeof entry.marketplace === "string" && typeof entry.name === "string") {
    const version = typeof entry.version === "string" ? entry.version : undefined;
    const originRef = `${entry.name}@${entry.marketplace}`;
    return {
      raw: JSON.stringify(entry),
      sourceKind: "marketplace",
      name: entry.name,
      originRef,
      applySelector: originRef,
      ...(version ? { versionConstraint: version } : {}),
    };
  }

  if (typeof entry.id === "string") {
    const version = typeof entry.version === "string" ? entry.version : undefined;
    const parsed = parseApmDependencyString(entry.id);
    const selector = version && parsed.sourceKind === "catalog"
      ? `${entry.id}@${version}`
      : parsed.applySelector;
    return {
      ...parsed,
      raw: JSON.stringify(entry),
      applySelector: selector,
      originRef: parsed.sourceKind === "catalog" ? selector : parsed.originRef,
      ...(version ? { versionConstraint: version, ref: parsed.ref ?? version } : {}),
    };
  }

  if (typeof entry.git === "string") {
    const ref = typeof entry.ref === "string" ? entry.ref : undefined;
    const parsed = parseApmDependencyString(ref ? `${entry.git}#${ref}` : entry.git);
    const path = typeof entry.path === "string" ? entry.path : undefined;
    return {
      ...parsed,
      raw: JSON.stringify(entry),
      originRef: path ? `${parsed.originRef}#${path}` : parsed.originRef,
      ...(ref ? { ref, versionConstraint: ref } : {}),
    };
  }

  if (typeof entry.path === "string") {
    return parseApmDependencyString(entry.path);
  }

  throw new Error("dependencies.apm object must include git, id, path, or marketplace");
}

export function parseApmDependencyList(value: unknown): ParsedApmDependency[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("dependencies.apm must be a list");
  }
  return value.map(parseApmDependencyEntry);
}

function mcpTransport(value: unknown): "stdio" | "http" | undefined {
  if (value === "stdio") {
    return "stdio";
  }
  if (value === "http" || value === "sse" || value === "streamable-http") {
    return "http";
  }
  return undefined;
}

export function parseMcpDependencyEntry(entry: unknown): ParsedMcpDependency {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    const name = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    return {
      raw: trimmed,
      name,
      registryId: trimmed,
      selfDefined: false,
    };
  }
  if (!isRecord(entry)) {
    throw new Error("dependencies.mcp entries must be strings or mappings");
  }

  const name = typeof entry.name === "string" && entry.name.length > 0
    ? entry.name
    : undefined;
  if (!name) {
    throw new Error("dependencies.mcp object must include a name");
  }

  const registry = entry.registry;
  const selfDefined = registry === false;
  const argsRaw = entry.args;
  const args = Array.isArray(argsRaw) ? argsRaw.map((value) => String(value)) : undefined;

  return {
    raw: JSON.stringify(entry),
    name,
    ...(typeof registry === "string" ? { registryId: registry } : {}),
    ...(!selfDefined && typeof name === "string" && !registry ? { registryId: name } : {}),
    transport: mcpTransport(entry.transport),
    ...(typeof entry.command === "string" ? { command: entry.command } : {}),
    ...(args ? { args } : {}),
    ...(typeof entry.url === "string" ? { url: entry.url } : {}),
    ...(stringMap(entry.env) ? { env: stringMap(entry.env) } : {}),
    ...(stringMap(entry.headers) ? { headers: stringMap(entry.headers) } : {}),
    selfDefined,
  };
}

export function parseMcpDependencyList(value: unknown): ParsedMcpDependency[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("dependencies.mcp must be a list");
  }
  return value.map(parseMcpDependencyEntry);
}

export function collectApmAndDevDependencies(document: Record<string, unknown>): {
  apm: ParsedApmDependency[];
  mcp: ParsedMcpDependency[];
} {
  const dependencies = isRecord(document.dependencies) ? document.dependencies : {};
  const devDependencies = isRecord(document.devDependencies) ? document.devDependencies : {};
  return {
    apm: [
      ...parseApmDependencyList(dependencies.apm),
      ...parseApmDependencyList(devDependencies.apm),
    ],
    mcp: [
      ...parseMcpDependencyList(dependencies.mcp),
      ...parseMcpDependencyList(devDependencies.mcp),
    ],
  };
}
