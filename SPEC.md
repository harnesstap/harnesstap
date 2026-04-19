# Skilldeck CLI specification

This document describes the current shipped behavior of `skilldeck` in this
repository as of March 29, 2026. It is implementation-first. When the code and
older design notes disagree, the code wins.

## Product summary

`skilldeck` is a local CLI for collecting AI coding assistant configuration,
grouping it into reusable presets, and applying those presets back to project
directories for multiple target platforms. Today, the canonical unit is a
`preset`, not a plugin package.

The current product supports six main workflows:

- Scan an existing repository and import assistant configuration into a local
  database.
- Import supported assistant defaults from the current home directory during
  init.
- Group imported resources into named presets.
- Apply a preset to one or more target platforms.
- Export or import a preset as a portable JSON bundle.
- Snapshot and revert tracked git projects.

## Current concepts

The CLI uses a small set of concepts consistently across commands.

- `resource`: a single canonical item such as an instruction, skill, rule,
  MCP server definition, permission rule, hook, agent, command, environment
  variable, or model configuration.
- `preset`: an ordered collection of resources. Presets are the main reusable
  unit in the current implementation.
- `template`: a preset flagged as reusable and seeded from the bundled JSON
  templates directory.
- `project`: a git-backed repository tracked by normalized git origin.
- `snapshot`: a saved copy of the files generated during `skilldeck apply`.

## Command surface

The table below describes the currently implemented CLI commands.

| Command                              | Current behavior                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skilldeck init`                      | Creates `~/.skilldeck/skilldeck.db`, initializes the schema, seeds built-in templates, scans supported home-directory defaults, and prints discovered locations. |
| `skilldeck scan [path]`               | Detects configured platforms in a project, imports discovered resources, and registers the project when a git origin exists.                                   |
| `skilldeck preset create`             | Creates a preset with optional description, tags, and template flag.                                                                                           |
| `skilldeck preset list`               | Lists presets, with optional template-only filtering.                                                                                                          |
| `skilldeck preset show`               | Shows preset metadata and its ordered resources.                                                                                                               |
| `skilldeck preset add`                | Adds a resource to a preset.                                                                                                                                   |
| `skilldeck preset remove`             | Removes a resource from a preset.                                                                                                                              |
| `skilldeck preset delete`             | Deletes a preset by name or ID.                                                                                                                                |
| `skilldeck resource list`             | Lists resources, with optional type and search filters.                                                                                                        |
| `skilldeck resource show`             | Prints the full stored resource, including metadata and content.                                                                                               |
| `skilldeck resource delete`           | Deletes a resource by ID.                                                                                                                                      |
| `skilldeck apply <preset>`            | Serializes a preset for target platforms and writes files into the project directory.                                                                          |
| `skilldeck history`                   | Lists stored snapshots for the current tracked project.                                                                                                        |
| `skilldeck revert <snapshot-id>`      | Restores files captured in a saved snapshot.                                                                                                                   |
| `skilldeck export <preset>`           | Writes a portable JSON bundle for a preset.                                                                                                                    |
| `skilldeck import <file>`             | Imports a preset bundle from disk.                                                                                                                             |
| `skilldeck platforms`                 | Lists registered platforms and declared capability flags.                                                                                                      |
| `skilldeck status [path]`             | Shows the detected platforms and tracked preset and snapshot counts for a project.                                                                             |
| `skilldeck template list`             | Lists seeded built-in templates.                                                                                                                               |
| `skilldeck template apply <template>` | Applies a built-in template to a project.                                                                                                                      |

## Storage and state

`skilldeck` currently stores all persistent operational state in SQLite. The
separate JSON config file proposed in earlier design notes does not exist yet.

### Database location

The database lives at `~/.skilldeck/skilldeck.db`. The CLI creates the directory
on demand and opens the database through `better-sqlite3` with WAL mode and
foreign keys enabled.

### Schema

The current schema version is `1`. The schema includes these tables:

- `resources`: canonical configuration items.
- `presets`: named collections of resources.
- `preset_resources`: ordered many-to-many link table between presets and
  resources.
- `projects`: tracked repositories keyed by normalized git origin.
- `project_presets`: which presets have been applied to which projects and for
  which platform list.
- `snapshots`: saved generated output captured before apply writes files.
- `schema_version`: migration tracking.

### Project tracking

Project tracking is git-oriented. During `scan` and `apply`, `skilldeck` reads
the repository's `origin` remote, normalizes it, and uses that value as the
project identity. The last known local path is stored for convenience, but the
git origin is the durable key.

### Snapshot behavior

Snapshots are created during `skilldeck apply` when the target directory has a
git origin. The snapshot stores the generated platform file map for the preset
being applied. `skilldeck revert` restores those stored files directly to the
project path.

## Canonical model

The canonical model is broader than any single platform format, but it is still
intentionally small in the current implementation.

### Resource types

`skilldeck` supports these resource types today:

- `instruction`
- `skill`
- `rule`
- `mcp_server`
- `permission`
- `hook`
- `agent`
- `command`
- `env_var`
- `model_config`

Metadata is stored as JSON and varies by resource type. The TypeScript source
declares structured metadata for rules, skills, MCP servers, permissions,
hooks, agents, environment variables, and model configuration.

### Preset model

Presets are the current shareable unit. A preset has a unique name,
description, tag list, and `is_template` flag. Resource order is stored in the
join table and is preserved during serialization.

## Platform model

Platform support is split between a registry and serializers. The registry
declares capability flags and default project and global paths. Serializers
implement scan and write behavior.

### Native serializers

`skilldeck` has dedicated serializers for these platforms:

- `claude-code`
- `codex`
- `cursor`

These serializers read and write platform-specific files such as `CLAUDE.md`,
`.claude/skills/`, `.cursor/rules/`, `AGENTS.md`, `.codex/config.toml`, and
related directories.

### Generic serializer

All other registered platforms currently use the generic serializer. It relies
on the registry's declared paths to scan and materialize instruction and skill
layouts rather than implementing a fully native parser for each platform.

### Registered platforms

The registry currently contains 30 platform IDs:

- `claude-code`
- `codex`
- `cursor`
- `warp`
- `opencode`
- `github-copilot`
- `windsurf`
- `amp`
- `cline`
- `continue`
- `goose`
- `roo`
- `gemini-cli`
- `kilo`
- `augment`
- `firebender`
- `trae`
- `junie`
- `zencoder`
- `openhands`
- `deepagents`
- `qwen-code`
- `crush`
- `droid`
- `codebuddy`
- `mux`
- `kode`
- `command-code`
- `cortex`
- `neovate`

`skilldeck platforms` is the executable source of truth for this list.

## Scan, apply, and export behavior

The CLI uses straightforward behavior today. It favors deterministic file I/O
over merge-heavy workflows.

### Scan

`skilldeck scan` detects platforms by checking whether any declared project path
exists in the target directory. It then asks the relevant serializer to read
resources. The persistence layer deduplicates resources by `type:name` within a
single scan run before inserting them.

`skilldeck init` also checks the registry's declared global paths in the current
home directory. When supported files or folders exist, the CLI imports the
resources they contain, prints the discovered paths, and skips re-importing the
same home-source resource on later init runs.

### Apply

`skilldeck apply` loads a preset's resources, chooses the requested platforms or
auto-detects them from the project, serializes resources for each platform, and
writes the resulting files to disk. The write path creates directories as
needed and overwrites generated files directly.

### Export and import

Preset export and import use a JSON bundle format with schema
`https://skilldeck.dev/bundle-v1.json` and bundle version `1`. Each bundle
contains exactly one preset definition and a flat list of resources. Internal
database IDs, timestamps, and `source` fields are not exported.

## Built-in templates

The repository currently ships two bundled templates:

- `nextjs-fullstack`
- `python-fastapi`

`skilldeck init` seeds these templates into the database if they are not already
present. The same command also imports supported home-directory defaults.
Template application reuses the normal preset application flow.

## Build, test, and release workflow

The project now uses Bun for local dependency management, CI, and build
execution. The package is still intended for distribution through the npm
registry.

### Development commands

Use these commands while working on the repository:

```bash
bun install
bun run lint
bun run typecheck
bun run test:run
bun run build
```

### Build output

`tsup` builds the CLI from `src/index.ts` into `dist/` as a Node 20 ESM CLI
with declaration files and a `#!/usr/bin/env node` banner.

### Publish flow

The package publishes to the npm registry. The current package metadata uses
`prepublishOnly` to run `bun run build` before `npm publish`.

## Known gaps and non-goals

This section captures the biggest differences between the current codebase and
the larger long-term design that earlier notes described.

- There is no user-editable `~/.skilldeck/skilldeck-config.json` yet.
- The canonical unit is still a preset, not a multi-plugin package model.
- Only Claude Code, Codex, and Cursor have dedicated serializers today.
- Generic platform support is path-driven and intentionally shallow.
- Apply writes files directly and does not offer interactive conflict
  resolution.
- Export and import operate on one preset bundle at a time.
- There is no remote registry, install flow, or package marketplace yet.

## Near-term direction

The current codebase is already useful for local import, reuse, and alignment,
but it is still an early implementation. The next meaningful improvements are a
more explicit user config layer, richer per-platform serializers, and a sharing
model that grows beyond single-preset bundles.
