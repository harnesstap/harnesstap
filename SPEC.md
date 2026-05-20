# Harnessdeck CLI specification

This document describes the intended behavior of `harnessdeck`.

## Product summary

`harnessdeck` is a local CLI for collecting AI agent configuration, grouping it
into reusable presets, and syncing those presets into project directories across
multiple supported agent harnesses.

An **agent harness** is the complete infrastructure that wraps around an LLM and
makes it a functional agent. In practice, that includes things like skills, MCP
servers, hooks, plugins, rules, agent manifests, commands, and harness-specific
configuration files.

The product supports six main workflows:

- Scan an existing repository and import agent configuration into a local
  database.
- Initialize local state, choose supported agent harnesses, and choose a main
  harness reference.
- Group imported resources into named presets.
- Apply a preset using the main harness as the canonical representation.
- Sync a project across all configured agent harnesses.
- Export or import a preset as a portable JSON bundle.

## Core concepts

The CLI uses a small set of concepts consistently across commands.

- `resource`: a single canonical item such as an instruction, skill, rule,
  MCP server definition, permission rule, hook, agent, command, environment
  variable, or model configuration.
- `preset`: an ordered collection of resources. Presets are the main reusable
  unit.
- `agent harness`: a supported target environment such as Claude Code, Codex,
  Cursor, or another tool-specific agent wrapper.
- `main harness`: the project's canonical harness reference. Imports, preset
  application, and sync planning normalize through this harness first.
- `alias harness`: an additional supported harness that mirrors the main
  harness. Alias harnesses should use symlinks when the file layout allows it,
  and generated copies otherwise.
- `project`: a git-backed repository tracked by normalized git origin.
- `snapshot`: a saved copy of files generated during preset application or
  project sync.

## Command surface

The table below describes the intended CLI commands.

| Command                               | Intended behavior                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harnessdeck init`                    | Creates `~/.harnessdeck/harnessdeck.db`, initializes the schema, discovers supported home-directory defaults, prompts for the main harness, then prompts for additional supported harnesses to alias. |
| `harnessdeck scan [path]`             | Detects configured agent harnesses in a project, imports discovered resources, infers the existing harness as the main harness when one already exists, and registers the project when a git origin exists. |
| `harnessdeck preset create`           | Creates a preset with optional description and tags.                                                                                                                     |
| `harnessdeck preset list`             | Lists presets.                                                                                                                                                            |
| `harnessdeck preset show`             | Shows preset metadata and its ordered resources.                                                                                                                         |
| `harnessdeck preset add`              | Adds a resource to a preset.                                                                                                                                             |
| `harnessdeck preset remove`           | Removes a resource from a preset.                                                                                                                                        |
| `harnessdeck preset delete`           | Deletes a preset by name or ID.                                                                                                                                          |
| `harnessdeck resource list`           | Lists resources, with optional type and search filters.                                                                                                                  |
| `harnessdeck resource show`           | Prints the full stored resource, including metadata and content.                                                                                                         |
| `harnessdeck resource delete`         | Deletes a resource by ID.                                                                                                                                                |
| `harnessdeck apply <preset>`          | Applies a preset to the current project using the project's main harness as the canonical reference, then updates project metadata so later sync runs can materialize every supported harness. |
| `harnessdeck project sync [path]`     | Syncs the current project across all configured agent harnesses from the main harness reference, using symlinks for aliases when possible and generated files otherwise. |
| `harnessdeck history`                 | Lists stored snapshots for the current tracked project.                                                                                                                  |
| `harnessdeck revert <snapshot-id>`    | Restores files captured in a saved snapshot.                                                                                                                             |
| `harnessdeck export <preset>`         | Writes a portable JSON bundle for a preset.                                                                                                                              |
| `harnessdeck import <file>`           | Imports a preset bundle, normalizes it through the configured main harness, and records other selected harnesses as alias outputs for future sync.                     |
| `harnessdeck harness ls`              | Lists registered agent harnesses, showing which one is the current main harness and which ones are selected as aliases.                                                 |
| `harnessdeck harness configure`       | Re-runs the harness selection workflow so the user can update the main harness and alias harnesses using the same flow as `init`.                                       |
| `harnessdeck status [path]`           | Shows detected harnesses, the configured main harness, alias harnesses, and tracked preset and snapshot counts for a project.                                           |

## Initialization and harness selection

`harnessdeck init` is the first-run configuration flow and establishes the
default harness strategy for the local installation.

The init flow works in this order:

1. Initialize the local database.
2. Discover supported harness configuration already present in the user's home
   directory.
3. Prompt the user to choose the **main harness**. This is the canonical
   reference for future imports, preset application, and sync operations.
4. Prompt the user to choose any additional supported harnesses.
5. Mark those additional harnesses as **alias harnesses** and prefer symlinked
   materialization whenever the file layout and filesystem support it.

The CLI should allow the main harness to be selected even if that harness was
not the one first discovered on disk. The important invariant is that every
later sync operation has a single reference harness and a defined set of
secondary outputs.

`harnessdeck harness configure` reuses this same workflow after init so users
can change the reference harness and alias harness set without reinitializing
the rest of local state.

## Storage and state

`harnessdeck` stores persistent operational state in SQLite.

### Database location

The database lives at `~/.harnessdeck/harnessdeck.db`. The CLI creates the
directory on demand and opens the database through `better-sqlite3` with WAL
mode and foreign keys enabled.

### Schema

The schema should include these logical tables:

- `resources`: canonical configuration items.
- `presets`: named collections of resources.
- `preset_resources`: ordered many-to-many link table between presets and
  resources.
- `projects`: tracked repositories keyed by normalized git origin.
- `project_presets`: which presets have been applied to which projects.
- `project_harnesses`: the main harness, alias harnesses, and materialization
  strategy for each tracked project.
- `snapshots`: saved generated output captured before sync writes files.
- `schema_version`: migration tracking.

### Project tracking

Project tracking is git-oriented. During `scan`, `apply`, and `project sync`,
`harnessdeck` reads the repository's `origin` remote, normalizes it, and uses
that value as the project identity. The last known local path is stored for
convenience, but the git origin is the durable key.

### Snapshot behavior

Snapshots are created during `harnessdeck apply` and `harnessdeck project sync`
when the target directory has a git origin. A snapshot stores the generated file
map for the main harness and every alias harness that was materialized for that
sync. `harnessdeck revert` restores those stored files directly to the project
path.

## Canonical model

The canonical model is broader than any single harness format, but it remains
small and deterministic.

### Resource types

`harnessdeck` supports these resource types:

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

Metadata is stored as JSON and varies by resource type.

### Preset model

Presets are the shareable unit. A preset has a unique name, description, and
tag list. Resource order is stored in the join table and is preserved during
serialization.

Preset import and preset application always normalize through the configured
main harness. Alias harnesses are treated as derived outputs of the same
canonical preset, not as independent preset variants.

## Agent harness model

Harness support is split between a registry and serializers. The registry
declares capability flags and default project and global paths. Serializers
implement scan, canonicalization, aliasing rules, and write behavior.

### Native serializers

`harnessdeck` has dedicated serializers for these harnesses:

- `claude-code`
- `codex`
- `cursor`

These serializers read and write harness-specific files such as `CLAUDE.md`,
`.claude/skills/`, `.cursor/rules/`, `AGENTS.md`, `.codex/config.toml`, and
related directories.

### Generic serializer

All other registered harnesses may use the generic serializer. It relies on the
registry's declared paths to scan and materialize instruction and skill layouts
rather than implementing a fully native parser for each harness.

### Registered harnesses

The registry currently contains 30 harness IDs:

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

`harnessdeck harness ls` is the executable source of truth for this list and
for the user's current main and alias harness selection.

## Scan, apply, import, and sync behavior

The CLI favors deterministic file I/O over merge-heavy workflows.

### Scan

`harnessdeck scan` detects harnesses by checking whether any declared project
path exists in the target directory. It then asks the relevant serializer to
read resources. The persistence layer deduplicates resources by `type:name`
within a single scan run before inserting them.

When one supported harness already exists in a project, that harness becomes the
default main harness for the project. This preserves the existing project as the
initial source of truth instead of forcing an immediate conversion.

### Apply

`harnessdeck apply` loads a preset's resources, resolves the project's main
harness, serializes resources for that harness first, and updates project
metadata so the same canonical representation can be reused during later sync
runs.

If the project already contains a supported harness, that existing harness is
used as the main harness unless the user explicitly forces a shift to a
different configured main harness.

### Project sync

`harnessdeck project sync` materializes the main harness and every configured
alias harness for the project.

The sync rules are:

1. Use the project's main harness as the single reference representation.
2. Generate or refresh all configured alias harness outputs from that reference.
3. Use symlinks for alias harnesses when the target file layout is compatible
   and the filesystem supports symlinks.
4. Fall back to generated copies when symlinks are not possible.
5. Snapshot all generated files before overwriting them.

`harnessdeck project sync` should also support an option to force shifting the
project's reference harness from the currently detected existing harness to the
main harness configured by the user. This is the escape hatch for teams that
start from one harness but want the project to converge on another long-term
reference.

### Import and export

Preset export and import use a JSON bundle format with schema identifier
`urn:harnessdeck:bundle:v1` and bundle version `1`. Each bundle
contains exactly one preset definition and a flat list of resources. Bundles may
also include an optional top-level `claude` object with Claude Code marketplace
and plugin configuration (`extraKnownMarketplaces` and `enabledPlugins`
semantics). Internal database IDs, timestamps, and `source` fields are not
exported.

When importing a preset bundle, `harnessdeck` normalizes the imported resources
through the configured main harness and records all additional configured
harnesses as alias outputs for later project sync.

## Build, test, and release workflow

The project uses Bun for local dependency management, CI, and build execution.
The package is still intended for distribution through the npm registry.

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

The package publishes to the npm registry. The package metadata should run
`bun run build` before `npm publish`.

## Known gaps and non-goals

This section captures the biggest constraints in the current direction.

- Only a subset of registered harnesses will have fully native serializers at
  first.
- Generic harness support may remain path-driven and intentionally shallow.
- Sync writes files directly and does not yet provide interactive conflict
  resolution.
- Export and import operate on one preset bundle at a time.
- There is no remote registry, install flow, or package marketplace yet.

## Near-term direction

The next meaningful improvements are richer per-harness serializers, clearer
user configuration around main and alias harness defaults, and stronger sync
semantics for teams that want one canonical agent harness while still supporting
many downstream harness targets.
