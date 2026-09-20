export const AGENTS_INSTRUCTIONS_RESOURCE_NAME = "agents-instructions";
export const AGENTS_MD_DISPLAY_NAME = "Agent instructions (AGENTS.md)";
export const GLOBAL_SCOPE_LABEL = "global";

const LOCAL_ORIGIN_KINDS = new Set(["local", "local_snapshot", "manual"]);

const ORIGIN_KIND_LABELS: Record<string, string> = {
  local: "Local",
  marketplace_link: "Marketplace",
  untracked: "Untracked",
};

const PACKAGE_ENTRY_FILE_NAMES = new Set(["skill.md", "plugin.json"]);

export function groupedOriginKind(originKind: string): string {
  if (LOCAL_ORIGIN_KINDS.has(originKind)) {
    return "local";
  }
  return originKind;
}

export function formatOriginKindLabel(originKind: string): string {
  const grouped = groupedOriginKind(originKind);
  return ORIGIN_KIND_LABELS[grouped] ?? grouped.replaceAll("_", " ");
}

export function formatOriginDisplayLabel(
  originKind: string,
  originRef?: string | null,
  options?: { includeRef?: boolean },
): string {
  const kind = formatOriginKindLabel(originKind);
  const includeRef = options?.includeRef ?? true;
  const ref = originRef?.trim() ?? "";
  if (!includeRef || !ref) {
    return kind;
  }
  return `${kind} (${ref})`;
}

export function isAgentsMdResource(resource: {
  name: string;
  source?: string | null;
}): boolean {
  if (resource.name === AGENTS_INSTRUCTIONS_RESOURCE_NAME) {
    return true;
  }
  const source = (resource.source ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (!source) {
    return false;
  }
  return source === "AGENTS.md" || source.endsWith("/AGENTS.md");
}

export function resourceHumanName(resource: {
  name: string;
  source?: string | null;
}): string {
  return isAgentsMdResource(resource) ? AGENTS_MD_DISPLAY_NAME : resource.name;
}

export function formatResourceDisplayName(resource: {
  name: string;
  namespace?: string | null;
  source?: string | null;
}): string {
  const base = resourceHumanName(resource);
  const namespace = resource.namespace?.trim() ?? "";
  return namespace ? `${base}@${namespace}` : base;
}

export function formatResourceScopeLabel(namespace?: string | null): string {
  const ns = namespace?.trim() ?? "";
  return ns.length > 0 ? ns : GLOBAL_SCOPE_LABEL;
}

export function isPackageEntryFileName(fileName: string): boolean {
  return PACKAGE_ENTRY_FILE_NAMES.has(fileName.trim().toLowerCase());
}

/** Directory shown for SKILL.md / plugin.json package entry files; otherwise the path unchanged. */
export function packageDirectoryDisplayPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return trimmed;
  }
  const hasBackslash = trimmed.includes("\\") && !trimmed.includes("/");
  const separator = hasBackslash ? "\\" : "/";
  const normalized = trimmed.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[/\\]/);
  const fileName = parts[parts.length - 1] ?? "";
  if (!isPackageEntryFileName(fileName) || parts.length < 2) {
    return trimmed;
  }
  return parts.slice(0, -1).join(separator);
}

export function inferContainedFileType(relativePath: string): string {
  const top = relativePath.split("/")[0] ?? "";
  switch (top) {
    case "skills":
      return "skill";
    case "agents":
      return "agent";
    case "rules":
      return "rule";
    case "commands":
      return "command";
    case "hooks":
      return "hook";
    case "mcp":
      return "mcp_server";
    default:
      return "file";
  }
}

export function containedFileStem(relativePath: string): string {
  const base = relativePath.split("/").at(-1) ?? relativePath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return base;
  }
  return base.slice(0, dot);
}
