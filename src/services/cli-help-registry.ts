import type { Command } from "commander";

export interface CommandHelpEntry {
  description: string;
  /** Extra paragraphs shown under the short description on leaf-command help. */
  details?: string;
  examples?: string[];
}

export type CommandHelpRegistry = Record<string, CommandHelpEntry>;

export const COMMAND_HELP_REGISTRY: CommandHelpRegistry = {
  "help.scenario": {
    description: "Show a numbered scenario playbook from the docs",
    examples: ["help scenario 11", "help scenario 7 --format json"],
  },
  init: {
    description: "Initialize local HarnessTap state",
    examples: [
      "init",
      "init --main claude-code --aliases cursor,codex",
      "init --format json",
    ],
  },
  "init.completion": {
    description:
      "Generate shell completion scripts for bash, zsh, or fish",
    examples: [
      "init completion bash >> ~/.bashrc",
      "init completion zsh >> ~/.zshrc",
      "init completion fish > ~/.config/fish/completions/ht.fish",
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
      "Switch to a project-configured profile and environment from apm.yml",
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
    description: "Create a starter apm.yml from local profile plugins",
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
  apply: {
    description:
      "Resolve a plugin's dependency graph and materialize it into the project, or into machine home with --global",
    examples: [
      "apply base",
      "apply base --target cursor",
      "apply base --harness claude-code",
      "apply work --global",
      "apply ./build/my-pkg",
      "apply base --format json",
    ],
  },
  install: {
    description:
      "Onboard a project from apm.yml (same as apply with no plugin selector)",
    details:
      "Reads repo-root apm.yml, resolves dependencies.apm / dependencies.mcp, compiles local .apm/ primitives, writes apm.lock.yaml, and materializes resolved target harness directories. Target resolution: --target/--all/--harness, then targets: in apm.yml, then project/global harness preference, then filesystem auto-detect. Declared targets: win over preference and folder detection. Fails closed when no target can be resolved. Commit the lockfile plus generated harness output. Same project-scope flags as apply. Does not take a plugin selector or --global.",
    examples: [
      "install",
      "install --project .",
      "install --target cursor,claude",
      "install --harness claude-code,cursor",
      "install --dry-run",
      "install --update",
    ],
  },
  compile: {
    description:
      "Named apply-from-manifest entry: compile .apm/ primitives into resolved target harness directories",
    details:
      "Same overlay path as ht install / ht apply with no plugin selector: existing writers, apm.lock.yaml local_deployed_file_hashes, policy, and trust. Resolution order: --target / --all / --harness, then targets: in apm.yml, then project/global harness preference, then filesystem auto-detect. Declared targets: win over preference so install stays portable. Fails closed when no target resolves. Does not take a plugin selector or --global. compilation.strategy: distributed is noted and ignored; output stays single-file root context (AGENTS.md / CLAUDE.md).",
    examples: [
      "compile",
      "compile --target cursor",
      "compile -t claude,cursor --dry-run",
      "compile --all",
      "compile --project . --format json",
    ],
  },
  targets: {
    description:
      "Show which apply harness targets resolve for this project, and why",
    details:
      "Prints the canonical target table (or JSON) using the same resolution order as ht compile / ht install: CLI flags, then targets: in apm.yml, then project/global harness preference, then filesystem auto-detect. --all includes the agent-skills meta-target row. Use this to preview the set before pinning targets: for portable lockfile / harness ownership.",
    examples: [
      "targets",
      "targets --json",
      "targets --all --json",
      "targets --project .",
    ],
  },
  "lock.export": {
    description:
      "Export a CycloneDX or SPDX SBOM inventory from the existing lockfile",
    details:
      "Inventory export only: reads apm.lock.yaml and serializes it. Never re-resolves, re-hashes, or touches the network. Default format is CycloneDX 1.5; --format spdx writes SPDX 2.3. This is not a security attestation — the document is unsigned and does not claim SLSA. --timestamp pins the document time; otherwise SOURCE_DATE_EPOCH, then the lockfile generated_at. Diagnostics go to stderr so stdout stays pipe-clean.",
    examples: [
      "lock export",
      "lock export --format cyclonedx -o sbom.json",
      "lock export --format spdx --timestamp 2024-06-01T00:00:00+00:00",
      "lock export --project .",
    ],
  },
  pack: {
    description:
      "Pack an apm.yml project into an Agent Plugins 1.0 bundle (plugin.json + primitives + apm.lock.yaml)",
    details:
      "Writes build/<name>/ by default, or a .zip with --archive. Consumers install the artifact with ht apply <dir-or-zip>. Bundles are target-agnostic; plugin.json is metadata and is never deployed as a harness file.",
    examples: [
      "pack",
      "pack --archive -o ./dist",
      "pack --dry-run --verbose",
      "pack --format json",
    ],
  },
  audit: {
    description:
      "Scan a project for hidden Unicode, lockfile hashes, and apm-policy.yml",
    details:
      "Default scan covers lockfile-recorded deployed files plus local primitive dirs, and evaluates apm-policy.yml when present. --ci fails on critical Unicode, hash mismatch/extra/missing, blocking policy, or required-executable-untrusted. --require-policy with --ci fails if no policy file exists. --strip removes critical and warning characters (mutually exclusive with --ci). Use --file to scan any one file.",
    examples: [
      "audit",
      "audit --file .cursorrules",
      "audit --ci --require-policy --format json",
      "audit --strip --dry-run",
    ],
  },
  approve: {
    description: "Approve executable primitives from dependency packages",
    details:
      "Writes project apm.yml executables.allow by default. --user writes ~/.harnesstap/config.jsonc (can only narrow past org/project deny). --pending lists gated packages; --all approves them; --recommended accepts the org recommend set; --list shows the effective decision per locked package.",
    examples: [
      "approve owner/repo",
      "approve --user owner/repo",
      "approve --pending",
      "approve --all",
    ],
  },
  deny: {
    description: "Deny executable primitives from dependency packages",
    details:
      "Writes project apm.yml executables.deny by default. --user writes ~/.harnesstap/config.jsonc.",
    examples: ["deny owner/repo", "deny --user owner/repo"],
  },
  "policy.explain": {
    description: "Print the effective executable-trust decision for a package",
    details:
      "Shows allowed or blocked per executable type, the deciding policy layer, and shadowed lower-authority layers.",
    examples: ["policy explain owner/repo", "policy explain owner/repo --format json"],
  },
  "plugin.create": {
    description: "Create a new local plugin",
    examples: [
      "plugin create my-plugin",
      "plugin create my-plugin -d \"Team defaults\" --tags team",
      "plugin create skills --from mattpocock/skills --skill caveman",
    ],
  },
  "plugin.list": {
    description:
      "List local plugins plus streamed remote catalog plugins (default); use --local-only for local library only",
    examples: [
      "plugin list",
      "plugin list --search foundation",
      "plugin list --remote-only --tag profile",
    ],
  },
  "plugin.show": {
    description: "Show plugin details, resources, and plugin pins",
    examples: [
      "plugin show my-plugin",
      "plugin show my-plugin --format json",
    ],
  },
  "plugin.edit": {
    description:
      "Edit plugin composition and default environment (interactive or scripting)",
    examples: [
      "plugin edit my-plugin",
      "plugin edit my-plugin --add skill:caveman",
      "plugin edit my-plugin --environment dev",
    ],
  },
  "plugin.editor": {
    description: "Open a plugin definition file in your system editor",
    examples: ["plugin editor my-plugin"],
  },
  "plugin.delete": {
    description: "Delete a local plugin",
    examples: [
      "plugin delete my-plugin",
      "plugin delete",
    ],
  },
  "plugin.catalog.list": {
    description: "Show default and connected catalog sources",
    examples: [
      "plugin catalog list",
      "plugin catalog list --format json",
    ],
  },
  "plugin.catalog.connect": {
    description:
      "Connect an org or individual public plugin to the local catalog scope",
    examples: [
      "plugin catalog connect org acme",
      "plugin catalog connect plugin acme/default/foundation",
    ],
  },
  "plugin.catalog.disconnect": {
    description:
      "Disconnect a connected org or plugin from the local catalog scope",
    examples: [
      "plugin catalog disconnect org acme",
      "plugin catalog disconnect plugin acme/default/foundation",
    ],
  },
  "plugin.catalog.register": {
    description: "Register a publish catalog on this machine",
    examples: [
      "plugin catalog register acme/default",
      "plugin catalog register work@acme/releases",
    ],
  },
  "plugin.catalog.unregister": {
    description: "Remove a publish catalog from this machine",
    examples: ["plugin catalog unregister acme/default"],
  },
  "plugin.catalog.registered": {
    description: "List registered publish catalogs",
    examples: [
      "plugin catalog registered",
      "plugin catalog registered --format json",
    ],
  },
  "plugin.catalog.bindings": {
    description: "Configure which registered catalogs a plugin publishes to",
    examples: [
      "plugin catalog bindings my-plugin",
      "plugin catalog bindings my-plugin --add acme/default",
      "plugin catalog bindings my-plugin --clear",
    ],
  },
  "plugin.pull": {
    description: "Pull a plugin from the remote catalog into the local DB",
    examples: [
      "plugin pull acme/foundation",
      "plugin pull foundation --org acme --as local-foundation",
    ],
  },
  "plugin.publish.plan": {
    description: "Dry-run publish targets for a local plugin",
    examples: [
      "plugin publish plan my-plugin",
      "plugin publish plan my-plugin --format json",
    ],
  },
  "plugin.diff": {
    description: "Diff two plugins or a plugin and a plugin export file",
    examples: [
      "plugin diff left right",
      "plugin diff my-plugin ./export.ap.json",
    ],
  },
  "plugin.doctor": {
    description: "Run doctor checks against a plugin",
    examples: [
      "plugin doctor my-plugin",
      "plugin doctor my-plugin --format json",
    ],
  },
  "plugin.check": {
    description:
      "Compare library working heads to marketplace, git, and catalog origins",
    details:
      "Omit a name to check every syncable working head. --refresh force-fetches origins. "
      + "Outdated is not a failure; exit 1 only when a check row is error.",
    examples: [
      "plugin check",
      "plugin check my-plugin --refresh",
      "plugin check --format json",
    ],
  },
  "plugin.update": {
    description:
      "Update library working heads from marketplace, git, and catalog origins",
    details:
      "Pass a plugin name or --all. --all confirms on TTY unless --yes; non-interactive "
      + "--all requires --yes. --force reapplies when fingerprints already match.",
    examples: [
      "plugin update my-plugin",
      "plugin update --all --yes",
      "plugin update --all --yes --format json",
    ],
  },
  "plugin.cut": {
    description: "Cut a new local version from the working head",
    examples: [
      "plugin cut my-plugin --version 1.3.0",
      "plugin cut my-plugin --version 1.3.0 --format json",
    ],
  },
  "plugin.versions": {
    description: "List local frozen versions and the working head",
    examples: [
      "plugin versions my-plugin",
      "plugin versions my-plugin --format json",
    ],
  },
  "plugin.rollback": {
    description: "Restore a frozen version onto the working head",
    details:
      "Copies the frozen snapshot onto the current semver and marks the head dirty. " +
      "Does not apply the plugin. Non-interactive use requires --yes.",
    examples: [
      "plugin rollback my-plugin --to 1.0.0 --yes",
      "plugin rollback my-plugin --to 1.0.0 --yes --format json",
    ],
  },
  "plugin.why": {
    description:
      "Explain why a version was selected, or which plugin won a resource",
    details:
      "Answers why a version was selected, or which plugin won a given resource, " +
      "against the lockfile in the current project.",
    examples: [
      "plugin why base",
      "plugin why skill:deploy",
      "plugin why base --format json",
    ],
  },
  "plugin.fork": {
    description:
      "Create an editable authored copy of an upstream or catalog plugin",
    details:
      "Upstream and catalog plugins cannot be edited in place. A fork is an "
      + "authored plugin that starts with the same resources and dependencies.",
    examples: [
      "plugin fork web-search",
      "plugin fork web-search --as my-search",
      "plugin fork web-search --format json",
    ],
  },
  "plugin.from-project": {
    description: "Scan current folder and create a plugin from its resources",
    examples: [
      "plugin from-project my-plugin --project .",
      "plugin from-project team-plugin -d \"From repo\"",
    ],
  },
  "profile.list": {
    description:
      "List local profile plugins, then stream remote catalog plugins with tag=profile; marks active profile",
    examples: [
      "profile list",
      "profile list --search work",
      "profile list --local-only",
    ],
  },
  "profile.show": {
    description:
      "Show profile plugin details, resources, and dependencies",
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
  "profile.switch": {
    description:
      "Switch the active profile and restore the previous one on failure",
    examples: [
      "profile switch work",
      "profile switch work --harness claude-code",
      "profile switch work --format json",
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
  "profile.stash.list": {
    description: "List stashed profiles",
    examples: [
      "profile stash list",
      "profile stash ls --format json",
    ],
  },
  "profile.stash.pop": {
    description:
      "Restore the most recent stashed profile and remove it from the stash",
    examples: [
      "profile stash pop",
      "profile stash pop --harness claude-code",
    ],
  },
  "profile.stash.apply": {
    description:
      "Restore the most recent stashed profile without removing it from the stash",
    examples: [
      "profile stash apply",
      "profile stash apply --dry-run",
    ],
  },
  "profile.create": {
    description:
      "Create a profile plugin, promote an existing plugin, or import from a skill package",
    examples: [
      "profile create work",
      "profile create work --from mattpocock/skills --use",
      "profile create work -d \"Work profile\"",
    ],
  },
  "profile.delete": {
    description:
      "Demote a profile plugin and optionally delete the underlying plugin",
    examples: [
      "profile delete work",
      "profile delete work --plugin -y",
    ],
  },
  "profile.pull": {
    description: "Pull a profile plugin from catalog",
    examples: [
      "profile pull acme/work-profile",
      "profile pull work-profile --org acme --as work",
    ],
  },
  "profile.publish": {
    description: "Publish a profile plugin with validation warnings",
    examples: [
      "profile publish work",
      "profile publish work --org acme --catalog default",
    ],
  },
  "environment.create": {
    description:
      "Create a named environment bundle (blank, from project, or from configured plugin requirements)",
    examples: [
      "environment create dev",
      "environment create dev --from-project .",
      "environment create dev --from-plugin my-plugin --bind",
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
      "environment show dev --plugin my-plugin",
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
      "Export workspace, plugin, or resource as an Agent Plugins package or workspace archive",
    examples: [
      "migrate export backup.tar.gz --workspace",
      "migrate export --plugin my-plugin -o ./my-plugin",
      "migrate export --plugin my-plugin --single-file -o my-plugin.ap.json",
      "migrate export --resource skill:caveman",
    ],
  },
  "migrate.import": {
    description:
      "Import a package directory, .ap.json envelope, or .tar.gz workspace archive",
    examples: [
      "migrate import backup.tar.gz",
      "migrate import ./my-plugin",
      "migrate import my-plugin.ap.json",
    ],
  },
  "migrate.resolve-order": {
    description:
      "Pin last-applied resource winners as overrides where current resolution would pick a different plugin",
    examples: [
      "migrate resolve-order",
      "migrate resolve-order --dry-run",
      "migrate resolve-order --format json",
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
    description: "Log into HarnessTap Cloud via device authentication",
    examples: [
      "auth login",
      "auth login work --base-url https://harnesstap.com",
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
  "marketplace.add": {
    description: "Register a plugin marketplace URL",
    examples: [
      "marketplace add https://github.com/example/demo.git --name demo",
      "marketplace add https://github.com/example/demo.git --platform claude-code --format json",
    ],
  },
  "marketplace.list": {
    description: "List configured plugin marketplaces",
    examples: [
      "marketplace list",
      "marketplace ls --format json",
    ],
  },
  "marketplace.remove": {
    description: "Remove a configured plugin marketplace",
    examples: [
      "marketplace remove demo",
      "marketplace rm demo --format json",
    ],
  },
  "marketplace.show": {
    description: "List or browse plugins from a marketplace catalog",
    examples: [
      "marketplace show demo",
      "marketplace show demo --refresh --format json",
    ],
  },
  "plugin.search": {
    description: "Search marketplace catalogs for plugins",
    examples: [
      "plugin search typescript",
      "plugin search --refresh --format json",
    ],
  },
  "plugin.add": {
    description: "Add a dependency to a plugin",
    examples: [
      "plugin add base --to root",
      "plugin add fmt@demo --to team-stack",
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
