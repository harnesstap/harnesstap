# Skillset CLI — Unified AI Coding Assistant Configuration Manager

## Problem

Engineers use multiple AI coding CLIs (Claude Code, Codex, Cursor, OpenCode, Warp, Windsurf, and 40+ others). Each has its own configuration format for instructions, skills, rules, hooks, MCP servers, permissions, agents, and commands. There is no unified way to:

- Manage all these configurations in one place
- Create portable plugins tied to projects (via git origin)
- Share configurations across engineers and machines
- Align settings across platforms that support different feature subsets
- Version and revert configuration changes
- Reuse starter plugins for common application types

## Design Principles

- **Superset model**: The canonical data model covers every feature across all platforms. Each platform serializer emits what it supports and silently drops what it doesn't.
- **Git-origin anchoring**: Projects are identified by their git remote URL, not filesystem path. A plugin applied to `git@github.com:org/repo.git` works on any machine that clones the same repo.
- **Config-first local state**: Operator-managed configuration lives in `~/.skillset/skillset-config.json`. The SQLite database stores derived state such as imported resources, plugin membership, project bindings, and snapshots.
- **Bundle-first portability**: The canonical sharing contract is a portable
  bundle file. The SQLite database is local operational state, not the default
  interchange format.
- **Non-destructive history**: Every `apply` creates a snapshot. You can `revert` to any previous state.
- **Import-first**: The first workflow is scanning an existing project to populate the database.
- **Catalog parity with `skills`**: The initial platform catalog, default directories, and remote-skill update heuristics should mirror the `skills` project where practical so users can reuse the same platform names and expectations.
- **Plugin-first distribution**: The canonical shareable unit is a plugin. What used to be called a preset or a template is just a plugin with different metadata, tags, and export targets.

## Local configuration

`skillset` keeps user-editable defaults in
`~/.skillset/skillset-config.json`. This file is created by `skillset init`
and checked first on every command. The database remains the source of truth
for imported resources and history, but it must not be the only place where
path resolution and platform defaults live.

Recommended shape:

```json
{
  "schema_version": 1,
  "db_path": "~/.skillset/skillset.db",
  "default_platforms": ["claude-code", "cursor", "codex"],
  "path_resolution": {
    "respect_xdg": true,
    "env_overrides": {
      "claude-code": ["CLAUDE_CONFIG_DIR"],
      "codex": ["CODEX_HOME"]
    }
  },
  "scan": {
    "auto_detect_platforms": true,
    "include_global_paths": false
  },
  "alignment": {
    "reference_platform": "claude-code"
  },
  "apply": {
    "snapshot_before_write": true,
    "default_scope": "project",
    "link_mode": "auto"
  },
  "sharing": {
    "default_export_scope": "plugins",
    "include_project_bindings": false
  },
  "updates": {
    "github_token_env": ["GITHUB_TOKEN", "GH_TOKEN"],
    "default_ref": "main"
  },
  "platform_overrides": {
    "claude-code": {
      "global_paths": {
        "skills": "~/.claude/skills/"
      }
    }
  }
}
```

The config file should support explicit path overrides per platform, while the
default values are derived from the same conventions as the `skills` project,
including XDG-aware locations and environment-variable overrides. It must also
capture the default reference platform for alignment, the default link mode
used during materialization, and whether project bindings are included in
bundle exports.

## Plugin model

`skillset` centers everything around plugins. A plugin is a named, versioned,
shareable collection of canonical resources that can be applied directly to a
project or exported into one or more platform-specific layouts.

This keeps the design close to Claude Code's plugin model, which already has a
clear manifest-based structure with namespaced skills and root-level directories
for `skills/`, `agents/`, `commands/`, `hooks/`, and plugin-scoped settings.
For platforms that do not have a native plugin system, `skillset` still treats
the canonical unit as a plugin and materializes it as the closest supported
standalone configuration layout.

Import behavior must also understand plugin manifests. In particular,
`skillset scan` should recognize Claude-style `.claude-plugin/plugin.json`
files and grouped manifests such as `.claude-plugin/marketplace.json`, using
the same path-grouping ideas already present in the `skills` project to map
discovered skills back to the plugin that owns them.

There are no separate "preset" or "template" concepts in the data model:

- A project-specific plugin is a plugin applied to one or more git origins.
- A starter plugin is a built-in or imported plugin tagged for reuse, such as `nextjs-fullstack`.
- An exported plugin is a plugin rendered into a platform-specific package or bundle.

## Data Model (SQLite)

The database stores canonical resources, project bindings, and history. It is
optimized for local queries and snapshotting, while user-editable defaults stay
in `~/.skillset/skillset-config.json`.

### `platforms`

Static registry of supported coding CLIs and their capabilities.

- `id` TEXT PK — slug (`claude-code`, `cursor`, `codex`, `opencode`, `warp`, `windsurf`, …)
- `name` TEXT — display name
- `family` TEXT — enum such as `native`, `skills-first`, or `universal`
- `supports` JSON — feature flags: `{ instructions, skills, rules, mcp, permissions, hooks, agents, commands, env_vars, model_config }`
- `project_paths` JSON — where files live per feature at project scope (e.g. `{ "instructions": "CLAUDE.md", "skills": ".claude/skills/", "rules": ".claude/rules/" }`)
- `global_paths` JSON — same but for user/global scope
- `detect_markers` JSON — files or directories used for auto-detection

### `resources`

Canonical representation of a single configuration item.

- `id` TEXT PK (ULID)
- `type` TEXT — enum: `instruction | skill | rule | mcp_server | permission | hook | agent | command | env_var | model_config`
- `name` TEXT
- `description` TEXT
- `content` TEXT — the main body (markdown, TOML, JSON depending on type)
- `metadata` JSON — type-specific fields:
  - `rule`: `{ globs: string[], always_apply: boolean }`
  - `skill`: `{ scripts: string[], references: string[], source?: { provider: "github" | "gitlab" | "git" | "local" | "bundle" | "manual", source: string, source_url?: string, ref?: string, subpath?: string, resolver?: "github_tree_sha" | "content_hash" | "filesystem_hash", installed_hash?: string, last_checked_at?: string, updated_at?: string } }`
  - `mcp_server`: `{ transport: "stdio" | "http", command?: string, url?: string, args?: string[], env?: Record }`
  - `permission`: `{ action: "allow" | "deny" | "ask", pattern: string }`
  - `hook`: `{ event: string, script: string }`
  - `agent`: `{ model?: string, reasoning_effort?: string, sandbox_mode?: string }`
  - `env_var`: `{ key: string, value: string }`
  - `model_config`: `{ model: string, provider?: string }`
- `source` TEXT — where this was imported from (file path, URL, or `"manual"`)
- `created_at` TEXT (ISO 8601)
- `updated_at` TEXT (ISO 8601)

### `plugins`

Named, versioned, shareable collection of resources.

- `id` TEXT PK (ULID)
- `name` TEXT UNIQUE
- `description` TEXT
- `version` TEXT — semantic version for exported plugin artifacts
- `author` JSON — for example `{ "name": "Your Name", "email": "dev@example.com" }`
- `homepage` TEXT
- `repository` TEXT
- `license` TEXT
- `tags` JSON — `string[]`
- `source` TEXT — `manual | built-in | imported | scanned`
- `created_at` TEXT
- `updated_at` TEXT

The `name` field is the canonical plugin slug. When exporting to Claude Code,
it becomes the plugin namespace used in commands such as `/my-plugin:hello`.

### `plugin_resources`

Join table: which resources belong to which plugin.

- `plugin_id` TEXT FK → plugins.id
- `resource_id` TEXT FK → resources.id
- `order` INTEGER — controls serialization order (e.g. instructions concatenation)
- PK (`plugin_id`, `resource_id`)

### `projects`

Projects identified by git origin.

- `id` TEXT PK (ULID)
- `git_origin` TEXT UNIQUE — canonical remote URL (normalized: `git@github.com:org/repo.git`)
- `name` TEXT — human-readable label
- `local_path` TEXT — last-known filesystem path (informational, not authoritative)
- `created_at` TEXT

### `project_plugins`

Which plugins are applied to which project, and for which platforms.

- `project_id` TEXT FK → projects.id
- `plugin_id` TEXT FK → plugins.id
- `platforms` JSON — `string[]` of platform slugs to serialize for (e.g. `["claude-code", "cursor", "codex"]`)
- `reference_platform` TEXT — platform slug used as the alignment source for the
  most recent apply or update
- `applied_at` TEXT
- PK (`project_id`, `plugin_id`)

Project bindings are local operational state. Canonical bundle exports omit
them by default and include them only when the user explicitly requests
project metadata.

### `snapshots`

Point-in-time capture of a project's full configuration state.

- `id` TEXT PK (ULID)
- `project_id` TEXT FK → projects.id
- `label` TEXT — auto-generated or user-provided
- `state` JSON — full serialized state: `{ plugins: [...], resources: [...], platform_files: { "claude-code": { path: content }, ... } }`
- `created_at` TEXT

## Platform Serialization

`skillset` should not maintain a smaller, hand-picked platform universe than
the `skills` project. Its starting catalog should mirror the agent slugs from
`skills/src/types.ts`, with native serializers for platforms that need custom
formats and catalog-driven adapters for the rest.

### Platform catalog

Initial platform support should include the same user-facing slugs as
`skills`: `amp`, `antigravity`, `augment`, `claude-code`, `openclaw`,
`cline`, `codebuddy`, `codex`, `command-code`, `continue`, `cortex`,
`crush`, `cursor`, `deepagents`, `droid`, `firebender`, `gemini-cli`,
`github-copilot`, `goose`, `iflow-cli`, `junie`, `kilo`, `kimi-cli`,
`kiro-cli`, `kode`, `mcpjam`, `mistral-vibe`, `mux`, `neovate`,
`opencode`, `openhands`, `pi`, `pochi`, `qoder`, `qwen-code`, `replit`,
`roo`, `trae`, `trae-cn`, `warp`, `windsurf`, `zencoder`, and `adal`.

The pseudo-target `universal` from `skills` is useful as an implementation
detail for `.agents/skills` installs, but it should not be exposed as a
user-facing `skillset` platform.

Serializer strategy:

- Native serializers: `claude-code`, `codex`, `cursor`, `github-copilot`, `openclaw`, and `windsurf`
- Catalog-driven skill and instruction adapters: all remaining platforms
- Shared path families: `.agents/skills`, agent-specific skill directories such as `.roo/skills`, and XDG-based global directories where applicable

### Plugin materialization

Every plugin can be materialized in two ways:

- **Apply mode**: Write the plugin directly into a target project using each platform's normal project-scoped paths.
- **Export mode**: Build a distributable plugin artifact or configuration bundle for one platform or for all supported platforms.

The canonical cross-user sharing artifact is a JSON bundle. The SQLite database
remains local and is never treated as the default interchange format. Export
mode stays as close as possible to the target platform's native model. Claude
Code is the reference design because it has the richest published plugin
specification, while other exports map the same canonical plugin into each
platform's standalone configuration format.

#### Alignment source

Every apply or re-apply operation must select one platform as the alignment
source of truth before materializing the rest. By default, `skillset` reads the
global `alignment.reference_platform` config value. Commands may override it
with `--reference-platform <slug>`.

The alignment flow is:

1. Read the selected reference platform into canonical resources.
2. Normalize those resources into the superset model.
3. Materialize all requested target platforms from that normalized state.

If the configured reference platform is missing or cannot be parsed, `skillset`
must fail explicitly instead of silently switching to another platform.

#### Link strategy

When two or more materialized files are byte-identical after serialization,
`skillset` can reuse them through links instead of writing duplicate copies.
This behavior is controlled by `apply.link_mode`.

- `auto` — create symlinks when the system supports them, otherwise copy files
- `symlink` — require symlinks and fail with an actionable error if unavailable
- `copy` — always write independent files

Only outputs that remain semantically identical after serialization are
eligible for linking. Platform-specific wrappers, generated metadata, and
transformed files must always be written separately.

#### Claude Code export

Claude Code export must follow the published plugin layout closely:

- `.claude-plugin/plugin.json` for plugin metadata such as `name`, `description`, `version`, and optional author fields
- `skills/<skill-name>/SKILL.md`
- `agents/<agent-name>.md`
- `commands/<command-name>.md`
- `hooks/hooks.json`
- `.mcp.json`
- `settings.json`

If a plugin contains unsupported Claude-specific fields, `skillset` preserves
them only in Claude exports and drops them from other platform exports.

#### Non-Claude exports

Platforms without a native plugin package still receive an exported plugin, but
the output is a standalone configuration bundle using the platform's canonical
paths. Examples:

- Codex export: `AGENTS.md`, `.agents/skills/`, `.codex/config.toml`, `.codex/agents/`, `.codex/hooks.json`
- Cursor export: `AGENTS.md`, `.agents/skills/`, `.cursor/rules/`
- GitHub Copilot export: `.github/copilot-instructions.md`, `.agents/skills/`
- Generic skills-first export: `AGENTS.md` plus the catalog-defined `skills` directory for that platform

Each platform has a **Serializer** class that knows how to:

1. **Read** (import): scan a project directory and parse platform-specific files into canonical `Resource` objects.
2. **Write** (apply): take canonical resources and emit platform-specific files.

### Resource → Platform mapping

**instruction** (custom instructions / project context)

- Claude Code → `CLAUDE.md` or `.claude/CLAUDE.md`
- Codex and most catalog-driven platforms → `AGENTS.md`
- Cursor → `AGENTS.md` for shared context, plus `.cursor/rules/{name}.mdc` for native scoped rules
- Windsurf → `.windsurfrules`
- GitHub Copilot → `.github/copilot-instructions.md`
- Platforms without a native instruction file → best-effort mapping to `AGENTS.md` or the closest catalog-defined equivalent

**skill** (SKILL.md + scripts)

- Default behavior follows each platform's declared `skills` path in the catalog adopted from `skills`
- Platforms using `.agents/skills/` → symlink or copy `{name}/SKILL.md`
- Claude Code → `.claude/skills/{name}/SKILL.md`
- Agent-specific platforms → directories such as `.roo/skills/{name}/SKILL.md`, `.goose/skills/{name}/SKILL.md`, or `.windsurf/skills/{name}/SKILL.md`
- Cursor → `.agents/skills/{name}/SKILL.md`, with optional rule mirroring when the plugin explicitly asks for description-based activation

**rule** (path-scoped instructions)

- Claude Code → `.claude/rules/{name}.md` with `paths:` YAML frontmatter
- Cursor → `.cursor/rules/{name}.mdc` with `globs:` and `alwaysApply: false`
- Codex → subdirectory `AGENTS.md` or skill with path constraint
- Others → best-effort mapping to instructions

**mcp_server**

- Claude Code → `.mcp.json` (`mcpServers` object)
- Codex → `.codex/config.toml` (`[mcp_servers.{name}]`)
- Cursor → User/project MCP settings

**permission**

- Claude Code → `.claude/settings.json` (`permissions.allow` / `permissions.deny`)
- Codex → `.codex/config.toml` or execpolicy rules
- Others → skip (not widely supported)

**hook**

- Claude Code → `.claude/settings.json` hooks section
- Codex → `.codex/hooks.json`
- Others → skip

**agent** (subagents)

- Claude Code → `.claude/agents/{name}.md`
- Codex → `.codex/agents/{name}.toml`
- Others → skip or convert to skill

**command** (custom slash commands)

- Claude Code → `.claude/commands/{name}.md`
- Others → convert to skill or skip

**env_var / model_config**

- Claude Code → `.claude/settings.json` (`env`)
- Codex → `.codex/config.toml` top-level keys
- Others → platform-specific settings if available

## CLI Commands

The CLI is organized around four flows: configure local defaults, scan or
author canonical resources, manage plugins, materialize plugins to projects or
export targets, and keep tracked remote skills current over time.

### `skillset init`

Initialize `~/.skillset/`, create `~/.skillset/skillset-config.json`, seed
the platform catalog, and create the SQLite database.

### `skillset config show`

Show the resolved configuration after merging built-in defaults with
`~/.skillset/skillset-config.json`.

### `skillset config edit`

Open `~/.skillset/skillset-config.json` in `$EDITOR`.

### `skillset config set <key> <value>`

Update a single config key without editing the whole file.

### `skillset scan [path]`

Scan a project directory (default: `.`), auto-detect platforms, import all found configurations into the database as resources. Auto-detect git origin and register the project.

- `--platform <slug>` — scan only a specific platform
- `--dry-run` — show what would be imported without writing to DB
- If `.claude-plugin/plugin.json` is present, import plugin metadata and root-level plugin components
- If `.claude-plugin/marketplace.json` is present, import grouped plugin declarations before scanning child skills

### `skillset check [--project <git-origin|path>] [--plugin <name>]`

Check tracked remote skills for upstream changes without mutating local state.
For GitHub-backed skills, prefer the same folder-hash approach used by
`skills` by comparing the stored hash with the latest Git tree SHA for the
skill directory. Fall back to content or filesystem hashes for non-GitHub
sources.

- `--resource <id>` — check a specific tracked resource
- `--platform <slug>` — limit results to resources applied to a platform
- `--fail-on-updates` — exit non-zero when updates are available

### `skillset plugin create <name>`

Create a new empty plugin.

- `--description <text>`
- `--version <semver>` — default `0.1.0`
- `--tags <tag1,tag2>`

### `skillset plugin add <plugin> <resource-id|query>`

Add resources to a plugin by ID or by fuzzy search on name/type.

### `skillset plugin list`

List all plugins. Use `--built-in` to show starter plugins shipped with
`skillset`.

### `skillset plugin show <name>`

Show plugin contents, metadata, and export readiness.

### `skillset plugin remove <plugin> <resource-id>`

Remove a resource from a plugin.

### `skillset plugin delete <name>`

Delete a plugin entirely.

### `skillset apply <plugin> [--project <git-origin|path>] [--platform <slug,...>]`

Serialize a plugin's resources into platform-specific files at the target
project. Creates a snapshot before writing.

- `--project` defaults to current directory's git origin
- `--platform` defaults to auto-detected platforms, or all registered
- `--reference-platform <slug>` — override the configured alignment source for
  this operation
- `--link-mode <auto|symlink|copy>` — override the configured materialization
  strategy for this operation
- `--dry-run` — show what files would be written

### `skillset update [--project <git-origin|path>] [--plugin <name>]`

Refresh tracked remote skills, update the matching resource contents in the
database, and optionally re-apply affected plugins.

- `--resource <id>` — update a specific tracked resource
- `--apply` — re-serialize affected plugins after updating resources
- `--dry-run` — show which resources would change

### `skillset plugin export <plugin...> [--format <bundle|slug|all>] [--output <path>]`

Export one or more plugins into a canonical bundle or into one or more
platform-specific formats. The default export shape is a canonical bundle that
contains only the selected plugins and their resources.

- `--format bundle` — emit the canonical JSON bundle used for cross-user sharing
- `--format claude-code` — emit a Claude plugin directory with `.claude-plugin/plugin.json`
- `--format cursor` — emit a Cursor-compatible standalone bundle
- `--format codex` — emit a Codex-compatible standalone bundle
- `--format all` — emit one subdirectory per supported format
- `--output <path>` — target directory for the export
- `--project <git-origin|path>` — include project metadata from a specific
  project binding
- `--include-project-bindings` — include optional `projects` and
  `project_plugins` sections in the bundle
- `--zip` — optionally archive the output after export

### `skillset revert [snapshot-id]`

Revert a project to a previous snapshot. Without ID, shows interactive picker.

### `skillset history [--project <git-origin|path>]`

List snapshots for a project.

### `skillset resource list`

List all resources in the database.

- `--type <type>` — filter by resource type
- `--search <query>` — fuzzy search

### `skillset resource show <id>`

Show a single resource's full content.

### `skillset resource create`

Interactively create a new resource.

### `skillset resource edit <id>`

Open resource in `$EDITOR`.

### `skillset resource delete <id>`

Delete a resource.

### `skillset plugin import <file|url>`

Import a plugin from a canonical JSON bundle or a platform-specific source that
`skillset` can scan and normalize.

- canonical bundle imports create or update the included plugins and resources
- project bindings inside a bundle are ignored unless the user explicitly opts
  in during import
- `--as <name>` — import a plugin under a new local name when cloning a shared
  bundle

### `skillset platforms`

List all supported platforms and their capabilities.

### `skillset status [path]`

Show current project status: git origin, applied plugins, detected platforms,
last snapshot, and pending remote updates.

### `skillset diff [--project <path>] [--platform <slug>]`

Compare current project files against what the applied plugins would generate.
Shows drift.

## Project Structure

The codebase stays small by using native serializers only where a platform has
real format differences and falling back to catalog-driven adapters for the
large set of skills-first platforms.

```warp-runnable-command
skillset/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # CLI entry point (commander)
│   ├── db/
│   │   ├── schema.ts             # SQLite schema + migrations
│   │   ├── connection.ts         # Database singleton
│   │   └── migrations/           # Versioned SQL migrations
│   ├── config.ts                 # Reads/writes ~/.skillset/skillset-config.json
│   ├── models/
│   │   ├── resource.ts           # Resource CRUD
│   │   ├── plugin.ts             # Plugin CRUD
│   │   ├── project.ts            # Project CRUD
│   │   └── snapshot.ts           # Snapshot CRUD
│   ├── platforms/
│   │   ├── registry.ts           # Catalog derived from the skills-style platform matrix
│   │   ├── base-serializer.ts    # Abstract serializer interface
│   │   ├── claude-code.ts        # Claude Code serializer
│   │   ├── cursor.ts             # Cursor serializer
│   │   ├── codex.ts              # Codex serializer
│   │   ├── openclaw.ts           # OpenClaw serializer
│   │   ├── windsurf.ts           # Windsurf serializer
│   │   ├── github-copilot.ts     # GitHub Copilot serializer
│   │   └── generic-skills.ts     # Catalog-driven adapter for skills-first platforms
│   ├── commands/
│   │   ├── init.ts
│   │   ├── config.ts
│   │   ├── scan.ts
│   │   ├── check.ts
│   │   ├── plugin.ts
│   │   ├── apply.ts
│   │   ├── update.ts
│   │   ├── revert.ts
│   │   ├── history.ts
│   │   ├── resource.ts
│   │   ├── platforms.ts
│   │   ├── status.ts
│   │   └── diff.ts
│   ├── services/
│   │   ├── scanner.ts            # Project scanning orchestrator
│   │   ├── applier.ts            # Plugin application orchestrator
│   │   ├── updater.ts            # Remote skill check/update orchestration
│   │   ├── snapshot-manager.ts   # Snapshot create/restore
│   │   ├── git.ts                # Git origin detection + normalization
│   │   └── exporter.ts           # Export/import plugin bundles and platform artifacts
│   └── utils/
│       ├── ulid.ts
│       ├── frontmatter.ts        # YAML frontmatter parser/emitter
│       ├── toml.ts               # TOML parser/emitter (for Codex)
│       ├── prompts.ts            # Interactive prompts (inquirer)
│       └── logger.ts
├── test/
│   ├── platforms/                # Serializer round-trip tests
│   ├── services/                 # Service integration tests
│   └── fixtures/                 # Sample project dirs per platform
└── plugins/                      # Built-in starter plugins
  ├── nextjs-fullstack.json
  ├── python-fastapi.json
  ├── rust-cli.json
  └── go-microservice.json
```

## Tech Stack

The implementation favors a small dependency set, synchronous local storage,
and file-format libraries only where they are needed for platform fidelity.

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.x (strict mode)
- **CLI framework**: `commander` + `inquirer` for interactive prompts
- **Database**: `better-sqlite3` (synchronous, zero-config, single-file)
- **Path resolution**: `xdg-basedir` (or equivalent) for XDG-aware defaults
- **TOML**: `@iarna/toml` (for Codex config)
- **YAML frontmatter**: `gray-matter`
- **Glob matching**: `picomatch`
- **Unique IDs**: `ulid`
- **Testing**: `vitest`
- **Build**: `tsup` (esbuild-based bundler)
- **Package name**: `skillset` (published as `npx skillset`)

## Plugin bundle format

The canonical import and export format is a plugin bundle expressed as JSON.
This bundle is the default cross-user sharing artifact. Bundles should retain
optional remote-source metadata for updateable skills so `skillset check` and
`skillset update` continue to work after import.

```json
{
  "$schema": "https://skillset.dev/bundle-v1.json",
  "version": 1,
  "scope": {
    "plugins": ["my-team-plugin"],
    "include_project_bindings": false
  },
  "plugins": [
    {
      "name": "my-team-plugin",
      "description": "Standard config for our team",
      "version": "1.0.0",
      "tags": ["typescript", "react"],
      "author": {
        "name": "Platform Team"
      }
    }
  ],
  "resources": [
    {
      "type": "skill",
      "name": "find-skills",
      "content": "# Skill\n...",
      "metadata": {
        "source": {
          "provider": "github",
          "source": "vercel-labs/skills",
          "source_url": "https://github.com/vercel-labs/skills/tree/main/skills/find-skills",
          "subpath": "skills/find-skills",
          "resolver": "github_tree_sha",
          "installed_hash": "abc123"
        }
      }
    }
  ],
  "plugin_resources": [
    {
      "plugin": "my-team-plugin",
      "resource": "skill/find-skills",
      "order": 1
    }
  ]
}
```

Bundle exports may contain one or more plugins. They omit local-only tables such
as snapshots and never rely on a raw SQLite file for portability. When the user
opts in to project-aware sharing, the bundle adds optional `projects` and
`project_plugins` arrays keyed by canonical git origin.

## Example Workflows

These workflows show the intended end-to-end behavior for importing existing
configs, applying plugins, exporting platform-specific artifacts, and keeping
remote-backed skills up to date.

### 1. Import existing setup, share with team

```warp-runnable-command
skillset init
skillset scan .                          # imports from all detected platforms
skillset plugin create my-project-setup --version 1.0.0
skillset plugin add my-project-setup --all   # add all scanned resources
skillset plugin export my-project-setup --format bundle --output ./dist/my-project-setup.bundle.json
# teammate on another machine:
skillset plugin import ./dist/my-project-setup.bundle.json
skillset apply my-project-setup --reference-platform claude-code
```

### 2. Apply a built-in starter plugin to a new project

```warp-runnable-command
skillset plugin list --built-in
skillset apply nextjs-fullstack --platform claude-code,cursor,codex
```

### 3. Export a Claude Code plugin

```warp-runnable-command
skillset plugin export nextjs-fullstack --format claude-code --output ./dist/claude
```

### 4. Track upstream skill updates

```warp-runnable-command
skillset check --project .
skillset update --project . --apply
```

### 5. Align platforms after changing config

```warp-runnable-command
skillset config set alignment.reference_platform claude-code
skillset config set apply.link_mode auto
skillset diff                              # shows drift between DB and files
skillset apply my-project-setup            # re-serializes all platform files
```

### 6. Revert a bad config change

```warp-runnable-command
skillset history
skillset revert <snapshot-id>
```

## Open Questions / Future Work

The following items are deliberately left open because they affect packaging,
ecosystem shape, or collaboration workflows beyond the first release.

- **Remote registry**: A `skillset publish` / `skillset install` flow backed by a registry (like npm) for community-shared plugins.
- **Watch mode**: `skillset watch` to auto-detect file changes and sync back to DB.
- **Marketplace manifests**: Add first-class support for emitting Claude marketplace indexes such as `.claude-plugin/marketplace.json` when exporting multiple plugins together.
- **Third-party serializer plugins**: Allow external packages to add new platform exporters.
- **Conflict resolution**: When two plugins have overlapping resources for the same project, define merge strategy.
- **CI policy mode**: Add `skillset check --fail-on-drift --fail-on-updates` for CI enforcement.
