export type CommandCatalogKind = "group" | "project";

export type CommandLoaderId =
  | "apply"
  | "approve"
  | "audit"
  | "auth"
  | "compile"
  | "config"
  | "environment"
  | "github"
  | "harness"
  | "help"
  | "init"
  | "lock"
  | "marketplace"
  | "mcp"
  | "migrate"
  | "open"
  | "pack"
  | "plugin"
  | "policy"
  | "profile"
  | "project"
  | "resource";

export interface CommandCatalogEntry {
  name: string;
  aliases?: string[];
  description: string;
  kind: CommandCatalogKind;
  loader: CommandLoaderId;
  /** Commander-style args shown in top-level PROJECT help, e.g. `<source>`. */
  args?: string;
  hidden?: boolean;
}

export const COMMAND_CATALOG: CommandCatalogEntry[] = [
  {
    name: "auth",
    aliases: ["a"],
    description: "Authenticate with HarnessTap Cloud and manage cloud accounts",
    kind: "group",
    loader: "auth",
  },
  {
    name: "config",
    description: "Manage project profile config (apm.yml)",
    kind: "group",
    loader: "config",
  },
  {
    name: "environment",
    aliases: ["e"],
    description: "Manage reusable environments and plugin environment cascade",
    kind: "group",
    loader: "environment",
  },
  {
    name: "github",
    description: "Authenticate with GitHub for private marketplace and repo reads",
    kind: "group",
    loader: "github",
  },
  {
    name: "harness",
    aliases: ["h"],
    description: "Manage the registered harness set",
    kind: "group",
    loader: "harness",
  },
  {
    name: "help",
    description: "Core concepts and scenario playbooks",
    kind: "group",
    loader: "help",
  },
  {
    name: "lock",
    description: "Read apm.lock.yaml and export inventory artifacts",
    kind: "group",
    loader: "lock",
  },
  {
    name: "marketplace",
    aliases: ["mkt"],
    description: "Manage plugin marketplace sources",
    kind: "group",
    loader: "marketplace",
  },
  {
    name: "mcp",
    description: "Discover and install MCP Registry servers",
    kind: "group",
    loader: "mcp",
  },
  {
    name: "migrate",
    aliases: ["m"],
    description: "Export or import workspace, plugins, or resources for offline sharing",
    kind: "group",
    loader: "migrate",
  },
  {
    name: "plugin",
    aliases: ["l"],
    description: "Manage plugins (named bundles of resources that can be applied to a project)",
    kind: "group",
    loader: "plugin",
  },
  {
    name: "policy",
    description: "Inspect executable-trust and apm-policy.yml decisions",
    kind: "group",
    loader: "policy",
  },
  {
    name: "profile",
    aliases: ["p"],
    description: "Manage profile plugins and global profile switching",
    kind: "group",
    loader: "profile",
  },
  {
    name: "resource",
    aliases: ["r"],
    description:
      "Manage resources (individual pieces of AI configuration like agents, skills, or instructions)",
    kind: "group",
    loader: "resource",
  },
  {
    name: "add",
    args: "<source>",
    description: "Add skills from a remote or local source",
    kind: "project",
    loader: "init",
  },
  {
    name: "apply",
    args: "[plugins]",
    description: "Resolve a plugin's dependency graph and materialize it",
    kind: "project",
    loader: "apply",
  },
  {
    name: "approve",
    args: "[PACKAGE_REF]",
    description: "Approve executable primitives from dependency packages",
    kind: "project",
    loader: "approve",
  },
  {
    name: "audit",
    description:
      "Scan a project for hidden Unicode, lockfile hashes, apm-policy.yml, and executable trust",
    kind: "project",
    loader: "audit",
  },
  {
    name: "compile",
    description: "Compile local .apm/ primitives into resolved target harness directories",
    kind: "project",
    loader: "compile",
  },
  {
    name: "deny",
    args: "[PACKAGE_REF]",
    description: "Deny executable primitives from dependency packages",
    kind: "project",
    loader: "approve",
  },
  {
    name: "history",
    args: "[path]",
    description: "List configuration snapshots for a project",
    kind: "project",
    loader: "project",
  },
  {
    name: "init",
    description: "Initialize the harnesstap database and config directory",
    kind: "project",
    loader: "init",
  },
  {
    name: "install",
    description: "Onboard a project from apm.yml (same as apply with no plugin selector)",
    kind: "project",
    loader: "apply",
  },
  {
    name: "mirror",
    args: "[path]",
    description:
      "Rematerialize registered harness files from one on-disk harness (or plugin/AGENTS.md fallback)",
    kind: "project",
    loader: "project",
  },
  {
    name: "open",
    args: "[path]",
    description: "Open a file or directory in your system editor",
    kind: "project",
    loader: "open",
  },
  {
    name: "pack",
    description:
      "Pack an apm.yml project into an Agent Plugins 1.0 bundle (plugin.json + primitives + apm.lock.yaml)",
    kind: "project",
    loader: "pack",
  },
  {
    name: "revert",
    args: "[snapshot-id]",
    description: "Revert a project or global apply snapshot",
    kind: "project",
    loader: "project",
  },
  {
    name: "scan",
    args: "[path]",
    description:
      "Scan a project directory or plugin source and import configurations into the database",
    kind: "project",
    loader: "project",
  },
  {
    name: "status",
    args: "[path]",
    description: "Show current project status and drift summary",
    kind: "project",
    loader: "project",
  },
  {
    name: "targets",
    description: "Show which apply harness targets resolve for this project, and why",
    kind: "project",
    loader: "compile",
  },
  {
    name: "use",
    description: "Switch to a project-configured profile and environment",
    kind: "project",
    loader: "project",
  },
  {
    name: "layer",
    description: "",
    kind: "project",
    loader: "plugin",
    hidden: true,
  },
  {
    name: "__complete",
    description: "",
    kind: "project",
    loader: "help",
    hidden: true,
  },
];

export const COMMAND_LOADER_IDS: CommandLoaderId[] = [
  "apply",
  "approve",
  "audit",
  "auth",
  "compile",
  "config",
  "environment",
  "github",
  "harness",
  "help",
  "init",
  "lock",
  "marketplace",
  "mcp",
  "migrate",
  "open",
  "pack",
  "plugin",
  "policy",
  "profile",
  "project",
  "resource",
];

export function visibleCatalogEntries(kind: CommandCatalogKind): CommandCatalogEntry[] {
  return COMMAND_CATALOG
    .filter((entry) => !entry.hidden && entry.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findCatalogEntry(token: string): CommandCatalogEntry | undefined {
  return COMMAND_CATALOG.find(
    (entry) => entry.name === token || entry.aliases?.includes(token),
  );
}

export function topLevelCommandTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const entry of COMMAND_CATALOG) {
    tokens.add(entry.name);
    for (const alias of entry.aliases ?? []) {
      tokens.add(alias);
    }
  }
  return tokens;
}

export function catalogCommandLabel(entry: CommandCatalogEntry): string {
  let label = entry.name;
  if (entry.aliases && entry.aliases.length > 0) {
    label += ` (${entry.aliases.join(", ")})`;
  }
  if (entry.args) {
    label += ` ${entry.args}`;
  }
  return label;
}
