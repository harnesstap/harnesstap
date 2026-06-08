# Environment commands design

**Date:** 2026-06-07  
**Status:** Approved  
**Related:** [SPEC.md](../../../SPEC.md)

## Problem

HarnessDeck has a complete environment data model and apply-time cascade (`home ◂ layer default ◂ deck active`), but no CLI surface to create environments, bind them to layers, switch the active environment, or capture environment values from an existing project. Users cannot complete the *how* axis without calling library APIs directly.

## Goals

1. Add an `environment` command group (Plan A) mirroring existing nouns (`harness`, `resource`, `layer`).
2. Bridge environments to configured layers (`layer set-environment`).
3. Simplify vocabulary: **environment** and **environment values** only — drop "settings" as an umbrella term.
4. Support **scoped capture** from project state: create or refresh an environment from only the values required by the layer stack, not the full machine environment.
5. `environment use` updates the active pointer only; `--reapply` is opt-in.

## Non-goals (this design)

- Full `deck` command group (library APIs remain; deck active switching lives on `environment use --project`).
- `project apply --environment` one-shot override (future).
- `environment doctor` for unmet `needs` (Phase 3).
- Embedding secret literals in environments or deck transport.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Environment** | Named, swappable bundle of runtime *how* configuration (e.g. `prod`, `staging`, `personal`). |
| **Environment value** | One item in an environment: `env_var`, `model_config`, `permission`, or a **secret reference**. |
| **Secret reference** | Pointer to a secret (`keychain`, `env`, `file`) — never the secret value itself. |
| **Toolkit configuration** | HarnessDeck-local preferences: `harness_preferences`, `project_harnesses`, `~/.harnessdeck/config.jsonc`. Not an environment. |
| **Environment capture** | Create or update environment values from project/harness state. Distinct from **apply snapshots** (`project history` / `project revert`). |

### Environment value types

```
environment
├── env_var values        (PD_REGION=us)
├── model_config values   (default model, provider)
├── permission values     (allow/deny patterns)
└── secret references     (PD_TOKEN → env:PD_TOKEN)
```

Plugins declare **requirements** via `needs[]`. MCP server definitions declare **env keys** in `mcp_server.env`. Environments **satisfy** those requirements with environment values.

## Architecture

### Storage

- **Canonical store:** SQLite (`environments`, `environment_resources`, `environment_secret_refs`).
- **Transport:** `~/.harnessdeck/environments/<name>.json` and `.harnessdeck/environments/<name>.json` in deck repos (non-secret values + secret refs, never literal secrets).
- **Active pointer:** `~/.harnessdeck/active-environment.json` (home) and `deck.json` `active_environment` (deck).

CLI mutations write to SQLite first. `environment export` materializes transport files.

### Cascade (unchanged)

```
home active environment  ◂  layer default environment  ◂  deck active environment
                              (last wins)
```

On `project apply`, merged environment values override matching resources during serialization.

### Layer bridge

`project apply` targets **configured layers**. The CLI `layer` noun primarily manages **design plugins**, but bridge commands resolve through `resolveConfiguredLayerSelector` (same as apply), creating an implicit single-plugin configured layer when needed.

## Command surface

### Noun alias

| Full noun | Alias |
| --- | --- |
| `environment` | `e` |

### `environment` subcommands

| Command | Behavior |
| --- | --- |
| `environment create <name>` | Create an empty environment. |
| `environment list` | List environments (`NAME`, value counts, bound layers). |
| `environment show <name>` | Show environment values, secret refs, reverse refs to layers/decks. |
| `environment delete <name>` | Delete if unreferenced; `--force` with warnings when referenced. |
| `environment set <name> --var KEY=VALUE` | Upsert an `env_var` environment value (repeatable). |
| `environment set <name> --model <name> …` | Upsert a `model_config` environment value. |
| `environment set <name> --permission <rule>` | Upsert a `permission` environment value. |
| `environment unset <name> --var KEY` | Remove an environment value. |
| `environment secret set <name> KEY --provider keychain\|env\|file --ref …` | Add or update a secret reference. |
| `environment secret unset <name> KEY` | Remove a secret reference. |
| `environment import <file>` | Upsert from deck environment JSONC format. |
| `environment export <name> [file]` | Write portable JSONC (non-secret values + secret refs). |
| `environment use <name>` | Set home active environment pointer. |
| `environment use <name> --project <path>` | Set deck active environment in `.harnessdeck/deck.json` (and DB deck row when tracked). |
| `environment use … --reapply` | Opt-in: re-run last applied layers after pointer change. |
| `environment active` | Show home/deck active environment and cascade preview. |
| `environment resolve --layers <l…> [--project <path>]` | Dry-run merged environment values per cascade tier. |
| `environment capture <name> --project <path>` | Create environment from scoped capture (see below). |
| `environment refresh <name> --project <path>` | Update existing environment from scoped capture. |

Shared flags for read commands: `--format human|json`. Capture/refresh also support `--dry-run`, `--strict`, `--layers`, `--include-permissions`.

### Layer bridge commands

| Command | Behavior |
| --- | --- |
| `layer set-environment <layer> <environment>` | Set `default_environment_id` on the configured layer. |
| `layer unset-environment <layer>` | Clear default environment binding. |

Enhancements to existing commands:

- `layer show` — display `Default environment: <name>` or `—`.
- `layer list` — optional `--show-environment` column.
- `project status` — show resolved cascade tiers (Phase 2).

### Selectors

- **Environments:** name or ULID (same ambiguity rules as other nouns).

## Environment capture

### Purpose

Create (`capture`) or update (`refresh`) an environment from the **current project state**, storing only environment values **required by the resource stack in scope** — not the full process environment.

### Scope

| Input | Default |
| --- | --- |
| `--project <path>` | Required |
| `--layers <l…>` | Project's last-applied configured layers |
| `--include-permissions` | Off |
| Model config from agents | On (default) |

Resolve the layer stack → merge plugins (same as apply) → walk composition recursively.

### Requirement set

Union from all plugins in scope:

| Source | Collect |
| --- | --- |
| `plugin.needs[]` | Env var keys the plugin contract expects |
| `mcp_server.metadata.env` | Keys in the MCP env map |
| `agent.metadata.model` | Model config when default inclusion is on |

Requirements are **declared by resources**, not discovered from the OS.

### Value resolution (per required key)

Priority order:

1. **Project harness files** (main harness) — read via existing serializers without a full DB import: settings `env`, MCP `env` blocks, harness equivalents for Codex/Cursor.
2. **Matching environment values** already in the library from a prior project scan.
3. **`process.env[key]`** — only for keys still missing after (1–2).

Never iterate `process.env` wholesale.

### Classification

| Situation | Store as |
| --- | --- |
| Value from harness file | `env_var` environment value |
| Value from `process.env`, secret heuristic (`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`) or `needs` key without file value | Secret reference `provider: env`, `ref: KEY` |
| Value from `process.env`, non-secret | `env_var` environment value |
| Required key missing everywhere | Warn and continue (default); `--strict` exits non-zero |

### Permissions

Off by default. With `--include-permissions`, capture permission environment values from harness settings files in the project.

### Example

```bash
hd environment capture oncall-staging --project .
# Plugin needs: PD_TOKEN, PD_REGION
# .claude/settings.json env: { PD_REGION: "eu" }
# Shell: PD_TOKEN set
# → env_var PD_REGION=eu
# → secret ref PD_TOKEN → env:PD_TOKEN
# → does not capture unrelated shell variables

hd environment refresh oncall-staging --project . --dry-run
```

## End-to-end workflow

```bash
hd layer create pagerduty-oncall
hd layer attach pagerduty-oncall skill:incident-runbook

hd environment create oncall-prod
hd environment set oncall-prod --var PD_REGION=us
hd environment secret set oncall-prod PD_API_TOKEN --provider env --ref PD_API_TOKEN

hd layer set-environment pagerduty-oncall oncall-prod
hd project apply pagerduty-oncall --project .

hd environment capture oncall-staging --project .   # alternative: bootstrap from project
hd environment use oncall-staging --project . --reapply
```

## CLI UX

- Follow existing output modes (`--format json`), selector ambiguity rules, and wizard mode for missing required args on TTY.
- JSON coverage for: `environment list|show|active|resolve`, `capture`/`refresh` with `--dry-run`.
- Capture missing keys: human warnings with key list; JSON includes `warnings[]` and `missing_keys[]`.

## Implementation phases

### Phase 1

- Spec vocabulary pass (SPEC.md).
- `environment create|list|show|delete|set|unset|secret set|unset`.
- `layer set-environment|unset-environment`.
- `layer show` default environment display.

### Phase 2

- `environment capture|refresh` with requirement scoping.
- `environment use|active|resolve`.
- `environment import|export`.
- `project status` cascade display.

### Phase 3

- `environment doctor` (unmet `needs`).
- Full `deck` noun.
- `project apply --environment` override.

## Testing

- Unit tests for requirement collection from `needs`, MCP env keys, and agent model metadata.
- Unit tests for value resolution priority and secret classification.
- CLI integration tests mirroring `test/cli/apply-environment.test.ts` for capture, refresh, use, and layer bridge.
- `--strict` vs default warn behavior on missing keys.
