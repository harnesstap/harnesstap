import type { Command } from "commander";

export interface CommandHelpEntry {
  description: string;
  examples?: string[];
}

export type CommandHelpRegistry = Record<string, CommandHelpEntry>;

export const COMMAND_HELP_REGISTRY: CommandHelpRegistry = {
  "help.scenario": {
    description: "Show a numbered scenario playbook from the docs",
    examples: ["help scenario 11", "help scenario 7 --format json"],
  },
  completion: {
    description:
      "Generate shell completion scripts for bash, zsh, or fish",
    examples: [
      "completion bash >> ~/.bashrc",
      "completion zsh >> ~/.zshrc",
      "completion fish > ~/.config/fish/completions/hd.fish",
    ],
  },
  init: {
    description: "Initialize local HarnessDeck state",
    examples: [
      "init",
      "init --main claude-code --aliases cursor,codex",
      "init --format json",
    ],
  },
  add: {
    description:
      "Install skills from a remote GitHub repo, Git URL, or local skill-package directory",
    examples: [
      "add mattpocock/skills",
      "add mattpocock/skills --list",
      "add mattpocock/skills --skill caveman,grill-me --global --yes",
    ],
  },
  scan: {
    description:
      "Import resources from a project tree (hash-aware upsert; prompts on content drift when interactive)",
    examples: [
      "scan",
      "scan ./my-project --dry-run",
      "scan --harness claude-code",
    ],
  },
  mirror: {
    description:
      "Mirror alias harness outputs from the main harness on-disk configuration",
    examples: [
      "mirror",
      "mirror . --dry-run",
      "mirror --reference auto --format json",
    ],
  },
  use: {
    description:
      "Switch to a project-configured profile and environment from .harnessdeck/config.toml",
    examples: [
      "use",
      "use --profile dev",
      "use --list",
      "use --profile dev --dry-run --format json",
    ],
  },
  "config.show": {
    description: "Show resolved project profile config",
    examples: [
      "config show",
      "config show --project . --format json",
    ],
  },
  "config.validate": {
    description: "Validate project profile config references",
    examples: [
      "config validate",
      "config validate --format json",
    ],
  },
  "config.init": {
    description: "Create a starter .harnessdeck/config.toml from local profile layers",
    examples: [
      "config init",
      "config init --profile work --profile personal --default work",
      "config init --force --format json",
    ],
  },
  status: {
    description: "Show current project status and drift summary",
    examples: [
      "status",
      "status --check",
      "status --format json",
    ],
  },
  history: {
    description: "List configuration snapshots for a project",
    examples: [
      "history",
      "history --format json",
      "history --show-id",
    ],
  },
  revert: {
    description: "Revert a project to a previous configuration snapshot",
    examples: ["revert <snapshot-id>"],
  },
  "layer.create": {
    description: "Create a new local layer",
    examples: [
      "layer create my-layer",
      "layer create my-layer -d \"Team defaults\" --tags team",
      "layer create skills --from mattpocock/skills --skill caveman",
    ],
  },
  "layer.list": {
    description:
      "List local layers plus streamed remote catalog layers (default); use --local-only for local library only",
    examples: [
      "layer list",
      "layer list --search foundation",
      "layer list --remote-only --tag profile",
    ],
  },
  "layer.show": {
    description: "Show layer details, resources, and plugin pins",
    examples: [
      "layer show my-layer",
      "layer show my-layer --format json",
    ],
  },
  "layer.edit": {
    description:
      "Edit layer composition and default environment (interactive or scripting)",
    examples: [
      "layer edit my-layer",
      "layer edit my-layer --add skill:caveman",
      "layer edit my-layer --environment dev",
    ],
  },
  "layer.editor": {
    description: "Open a layer definition file in your system editor",
    examples: ["layer editor my-layer"],
  },
  "layer.delete": {
    description: "Delete a local layer",
    examples: [
      "layer delete my-layer",
      "layer delete",
    ],
  },
  "layer.apply": {
    description:
      "Apply one or more layers (or a layer export URL) to a project, serializing for each harness",
    examples: [
      "layer apply my-layer",
      "layer apply team-base team-overrides --project .",
      "layer apply my-layer --dry-run",
    ],
  },
  "layer.catalog.list": {
    description: "Show default and connected catalog sources",
    examples: [
      "layer catalog list",
      "layer catalog list --format json",
    ],
  },
  "layer.catalog.connect": {
    description:
      "Connect an org or individual public layer to the local catalog scope",
    examples: [
      "layer catalog connect org acme",
      "layer catalog connect layer acme/default/foundation",
    ],
  },
  "layer.catalog.disconnect": {
    description:
      "Disconnect a connected org or layer from the local catalog scope",
    examples: [
      "layer catalog disconnect org acme",
      "layer catalog disconnect layer acme/default/foundation",
    ],
  },
  "layer.catalog.register": {
    description: "Register a publish catalog on this machine",
    examples: [
      "layer catalog register acme/default",
      "layer catalog register work@acme/releases",
    ],
  },
  "layer.catalog.unregister": {
    description: "Remove a publish catalog from this machine",
    examples: ["layer catalog unregister acme/default"],
  },
  "layer.catalog.registered": {
    description: "List registered publish catalogs",
    examples: [
      "layer catalog registered",
      "layer catalog registered --format json",
    ],
  },
  "layer.catalog.bindings": {
    description: "Configure which registered catalogs a layer publishes to",
    examples: [
      "layer catalog bindings my-layer",
      "layer catalog bindings my-layer --add acme/default",
      "layer catalog bindings my-layer --clear",
    ],
  },
  "layer.pull": {
    description: "Pull a layer from the remote catalog into the local DB",
    examples: [
      "layer pull acme/foundation",
      "layer pull foundation --org acme --as local-foundation",
    ],
  },
  "layer.publish.plan": {
    description: "Dry-run publish targets for a local layer",
    examples: [
      "layer publish plan my-layer",
      "layer publish plan my-layer --format json",
    ],
  },
  "layer.diff": {
    description: "Diff two layers or a layer and a layer export file",
    examples: [
      "layer diff left right",
      "layer diff my-layer ./export.harnessdeck.toml",
    ],
  },
  "layer.doctor": {
    description: "Run doctor checks against a layer",
    examples: [
      "layer doctor my-layer",
      "layer doctor my-layer --format json",
    ],
  },
  "layer.from-project": {
    description: "Scan current folder and create a layer from its resources",
    examples: [
      "layer from-project my-layer --project .",
      "layer from-project team-layer -d \"From repo\"",
    ],
  },
  "profile.list": {
    description:
      "List local profile layers, then stream remote catalog layers with tag=profile; marks active profile",
    examples: [
      "profile list",
      "profile list --search work",
      "profile list --local-only",
    ],
  },
  "profile.show": {
    description:
      "Show profile layer details, resources, and dependencies",
    examples: [
      "profile show work",
      "profile show work --format json",
    ],
  },
  "profile.status": {
    description:
      "Show the active profile and whether global harness files are in sync",
    examples: [
      "profile status",
      "profile status --check",
      "profile status --format json",
    ],
  },
  "profile.use": {
    description:
      "Merge profile stack, apply globally, and set active pointer; delegates to project config when present",
    examples: [
      "profile use work",
      "profile use --profile dev",
      "profile use work --dry-run",
      "profile use work --harness claude-code",
    ],
  },
  "profile.create": {
    description:
      "Create a profile layer, promote an existing layer, or import from a skill package",
    examples: [
      "profile create work",
      "profile create work --from mattpocock/skills --use",
      "profile create work -d \"Work profile\"",
    ],
  },
  "profile.delete": {
    description:
      "Demote a profile layer and optionally delete the underlying layer",
    examples: [
      "profile delete work",
      "profile delete work --layer -y",
    ],
  },
  "profile.pull": {
    description: "Pull a profile layer from catalog",
    examples: [
      "profile pull acme/work-profile",
      "profile pull work-profile --org acme --as work",
    ],
  },
  "profile.publish": {
    description: "Publish a profile layer with validation warnings",
    examples: [
      "profile publish work",
      "profile publish work --org acme --catalog default",
    ],
  },
  "environment.create": {
    description:
      "Create a named environment bundle (blank, from project, or from configured layer requirements)",
    examples: [
      "environment create dev",
      "environment create dev --from-project .",
      "environment create dev --from-layer my-layer --bind",
    ],
  },
  "environment.edit": {
    description:
      "Edit environment values interactively or via scripting flags",
    examples: [
      "environment edit dev",
      "environment edit dev --var API_URL=https://api.example.com",
      "environment edit dev --model claude-sonnet-4-20250514",
    ],
  },
  "environment.list": {
    description: "List named environment bundles",
    examples: [
      "environment list",
      "environment list --format json",
    ],
  },
  "environment.show": {
    description:
      "Show environment values, secret refs, and reverse references",
    examples: [
      "environment show dev",
      "environment show dev --layer my-layer",
    ],
  },
  "environment.delete": {
    description: "Delete a named environment",
    examples: [
      "environment delete dev",
      "environment delete dev --force",
    ],
  },
  "environment.use": {
    description:
      "Set the global active environment; --local applies only to this terminal session",
    examples: [
      "environment use dev",
      "environment use dev --local",
    ],
  },
  "environment.status": {
    description:
      "Show the active environment and whether terminal env vars match expected values",
    examples: [
      "environment status",
      "environment status --check",
      "environment status --format json",
    ],
  },
  "migrate.export": {
    description:
      "Export workspace, layer, environment, or resource for offline sharing",
    examples: [
      "migrate export backup.tar.gz --workspace",
      "migrate export --layer my-layer -o my-layer.harnessdeck.toml",
      "migrate export --resource skill:caveman",
    ],
  },
  "migrate.import": {
    description: "Import workspace, layer, or resource from file",
    examples: [
      "migrate import backup.tar.gz",
      "migrate import my-layer.harnessdeck.toml --layer",
    ],
  },
  "resource.list": {
    description: "List imported resources in the local library",
    examples: [
      "resource list",
      "resource list --type skill",
      "resource list --search caveman",
    ],
  },
  "resource.show": {
    description:
      "Show resource details (name, type:name, type:name@namespace, or ULID)",
    examples: [
      "resource show caveman",
      "resource show skill:caveman --format json",
    ],
  },
  "resource.sync": {
    description:
      "Sync plugin resources and marketplace-linked definitions from install trees",
    examples: [
      "resource sync",
      "resource sync plugin:my-plugin --dry-run",
      "resource sync --on-conflict overwrite",
    ],
  },
  "resource.delete": {
    description: "Delete a resource from the local library",
    examples: [
      "resource delete caveman",
      "resource delete",
    ],
  },
  "harness.list": {
    description: "List supported harnesses",
    examples: [
      "harness list",
      "harness list --supported --format json",
    ],
  },
  "harness.set": {
    description: "Set global harness preferences",
    examples: [
      "harness set --main claude-code --aliases cursor,codex",
    ],
  },
  "harness.status": {
    description: "Show global harness preferences",
    examples: [
      "harness status",
      "harness status --format json",
    ],
  },
  "harness.project.set": {
    description: "Set project-scoped harness preferences",
    examples: [
      "harness project set --main claude-code",
      "harness project set --project . --aliases cursor",
    ],
  },
  "harness.project.status": {
    description: "Show project-scoped harness preferences",
    examples: [
      "harness project status",
      "harness project status --format json",
    ],
  },
  "auth.login": {
    description: "Log into HarnessDeck Cloud via device authentication",
    examples: [
      "auth login",
      "auth login work --base-url https://cloud.harnessdeck.dev",
    ],
  },
  "auth.status": {
    description: "Show authenticated user and account context",
    examples: [
      "auth status",
      "auth status --account work --format json",
    ],
  },
  "auth.orgs": {
    description: "List organizations and optionally switch",
    examples: [
      "auth orgs",
      "auth orgs --switch acme",
    ],
  },
  "auth.logout": {
    description: "Log out and remove local cloud account",
    examples: [
      "auth logout",
      "auth logout --account work",
    ],
  },
};

function normalizeCommandName(name: string): string {
  const bracketIndex = name.indexOf(" ");
  return bracketIndex === -1 ? name : name.slice(0, bracketIndex);
}

export function resolveCommandHelpPath(cmd: Command): string {
  const segments: string[] = [];
  let current: Command | null = cmd;

  while (current?.parent) {
    segments.unshift(normalizeCommandName(current.name()));
    current = current.parent;
  }

  return segments.join(".");
}

export function getCommandHelpEntry(cmd: Command): CommandHelpEntry | undefined {
  return COMMAND_HELP_REGISTRY[resolveCommandHelpPath(cmd)];
}
