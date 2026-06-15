# Harnessdeck CLI specification

This document is the authoritative specification for `harnessdeck` / `hd`.

## Product summary

`harnessdeck` is an Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs. It collects agent configuration into canonical local **resources**, composes **what** into versioned **layers** (with optional default **environments**), curates layers into portable **decks** for git transport, and syncs the resolved setup into project directories across supported agent harnesses. Teams publish layers to HarnessDeck Cloud **catalogs** under an **organization** for multiplayer discovery, install, and governance.

An **agent harness** is the complete infrastructure that wraps around an LLM and makes it a functional agent. In practice, that includes skills, MCP servers, hooks, plugins, rules, agent manifests, commands, and harness-specific configuration files.

The product currently supports these main workflows:

- Initialize local state, seed built-in layers, discover supported home-directory defaults, and choose global harness preferences.
- Scan an existing repository (or plugin source) and import agent configuration into a local database.
- Group imported resources into versioned **local layers** (`name` + `version` only).
- Diff, doctor, export, import, publish, search, install, or derive layers from a project scan.
- Compose layers by attaching material resources, `plugin` references, and nested `layer` references through one attachment model.
- Apply one or more layers, a local bundle file, or a bundle URL to a project.
- Sync plugin composition resources from marketplace or local install roots via `resource sync`.
- Sync alias harness outputs, inspect drift from the latest snapshot, and revert a tracked project to an earlier snapshot.
- Export or import a machine-transfer archive of local layers, harness preferences, and config.
- Authenticate with HarnessDeck Cloud; search, install, and publish layers into org **catalogs**.
- Create, capture, and refresh **environments**; bind default environments to layers; switch home or deck active environment; resolve the home → layer default → deck-active cascade on `project apply`.

## Core concepts

```mermaid
flowchart TB
  subgraph Cloud["HarnessDeck Cloud (multiplayer)"]
    Org[organization]
    Cat[catalog]
    PubL[published layer versions]
    Org --> Cat --> PubL
  end

  subgraph Local["local workspace"]
    LL[local layer]
    Res[plugin-side resources]
    LL --> Res
  end

  subgraph Deck["deck — git transport"]
    DL1[layer + optional default environment]
    DL2[layer]
  end

  PubL -->|layer pull| Local
  Deck --> Cascade["home env ◂ layer default env ◂ deck active env"]
  Local --> Cascade
  Cascade --> Out[Harness outputs in the project]
```

The CLI uses a small set of concepts consistently across commands.

- `resource`: a single canonical item of kind `plugin` (what) or `environment` (how).
   - Plugin-side types: instruction, skill, rule, MCP server, hook, agent, command.
   - Environment-side types: env var, model config, permission, secret references.
- `layer`: a versioned, composable capability — an ordered bundle of plugin-side resources, composition attachments (`plugin` and `layer` resource refs), optional Claude marketplace/plugin config, a `needs` config contract satisfied by environment resources, and an optional default **environment**. Layers are what `project apply` targets. See [Layer identity & scope](#layer-identity--scope).
- `environment`: a named, swappable bundle of environment-side resources. Non-secret values can travel in a deck; secrets are referenced, not embedded.
- `organization`: a Cloud tenant boundary (members, roles, billing). Required to publish layers for multiplayer use.
- `catalog`: a named collection of layers within an organization — the browse, search, and install scope in Cloud and the CLI. Required alongside an organization when publishing; omitted for purely local layers.
- `deck`: a curated bundle of layers and environments, importable as a git repo and described by `.harnessdeck/deck.json`. Decks are the portable transport format; day-to-day multiplayer distribution flows through **catalogs**, not deck repos.
- `agent harness`: a supported target environment such as Claude Code, Codex, Cursor, or another tool-specific agent wrapper.
- `main harness`: the project's canonical harness reference. Imports, layer application, and sync planning normalize through this harness first.
- `alias harness`: an additional supported harness that mirrors the main harness. Alias harnesses use symlinks when the file layout allows it, and generated copies otherwise.
- `project`: a git-backed directory tracked by HarnessDeck, keyed by normalized `origin` when available.
- `snapshot`: a saved copy of files generated during layer application or project mirror.

### Layer identity & scope

Every layer has a **name** and **version** (semver). Identity is either **local** or **published**.

| Scope | Identity | Collision key | Cloud required? |
| --- | --- | --- | --- |
| **Local** | `name@version` | Unique in the local SQLite database | No — default for solo work |
| **Published** | `org/catalog/name@version` | Unique per org + catalog + name + version | Yes — required for `layer publish` and catalog browse |

**Selector grammar (target):**

```
layer_selector ::= [ org "/" catalog "/" ] name [ "@" version ]
```

Examples:

- `backend-oncall` — local layer; highest matching version when omitted.
- `backend-oncall@1.2.0` — local layer; exact version.
- `acme/platform-personas/frontend-engineer@2.1.0` — published layer in org `acme`, catalog `platform-personas`.

**Publishing rules:**

1. Local layers may be created, composed, exported, and applied with **no** organization or catalog.
2. `layer publish` requires an active Cloud organization, a target **catalog** name, and produces an immutable published version.
3. `layer search` and `layer pull` resolve against the CLI [catalog scope](#harnessdeck-cloud) (default public org + connected catalogs + authenticated private layers).

**Wire compatibility:** Cloud APIs and the CLI still accept `org/library[@version]` today. Treat `library` as the published **layer name** inside the org's default or named catalog until selectors migrate to `org/catalog/name`.

### Naming map (homonyms)

The words **plugin** and **layer** each appear in more than one role. Use this table to disambiguate.

| Concept | CLI | Storage (SQLite v15) |
| --- | --- | --- |
| **Layer** (versioned capability: resources + refs + optional default environment) | `hd layer …`, `project apply <layer>` | `layers` + `layer_resources` |
| **`plugin` resource** (marketplace/local reference attached to a layer) | `layer combine plugin:ref` or `--type plugin` | `resources` (`type=plugin`) + layer combinement rows |
| **`layer` resource** (composition ref to another layer) | `layer combine layer:name` or `--type layer` | `resources` (`type=layer`) + layer combinement rows |
| **Catalog** (org-scoped layer collection) | `layer catalog …`, `layer search`, `layer pull` | Cloud catalog APIs; `catalog` in `config.jsonc` |
| **Deck** | `.harnessdeck/deck.json`, deck doctor | `decks`, `deck_layers` |

Compat shims (`configured-layer.ts`, `listDeckConfiguredLayers`) delegate to `layer-model.ts` / `deck_layers` and are deprecated.

Layer freshness and composition use `resource sync`, `layer doctor`, and `project apply` plugin-version flags.

### Resource classification

| Plugin (*what*) | Environment (*how*) | Composition |
| --- | --- | --- |
| `instruction`, `skill`, `rule`, `mcp_server`, `hook`, `agent`, `command` | `env_var`, `model_config`, `permission` | `plugin`, `layer` |

An `mcp_server` **definition** lives on the layer; tokens and URLs are contract keys (`needs`) filled by an environment.

`layer` composition resources are hidden from default `resource list`; `plugin` resources are listed.

### Environment values

An **environment** is a named bundle of **environment values** — the runtime *how* configuration that layers may depend on:

| Kind | Storage |
| --- | --- |
| `env_var` | Non-secret key/value pairs |
| `model_config` | Model and provider selection |
| `permission` | Allow/deny/ask patterns |
| Secret reference | `environment_secret_refs` (`keychain`, `env`, `file`) — never the secret value |

Layers declare requirements via `needs[]`; MCP server definitions declare env keys in `mcp_server.env`. Environments satisfy those requirements.

**Toolkit configuration** (`harness_preferences`, `project_harnesses`, `~/.harnessdeck/config.jsonc`) controls HarnessDeck behavior and harness selection. It is not an environment.

See [Environment capture](#environment-capture) for creating or refreshing environments from project state.

### Resource identity and selectors

Resources are uniquely keyed by `(type, name, namespace)` where `namespace=''` means unnamespaced.

Selector grammar:

```
selector ::= [ type ":" ] name [ "@" namespace ]
```

Examples: `brainstorming`, `skill:brainstorming@cursor-team-kit`, `plugin:posthog@cursor-team-kit`, `layer:backend-oncall`, `01J…` (ULID id).

- **Display** commands (`resource show`, `resource delete`): bare names prefer the unnamespaced row when present; otherwise list ambiguous matches.
- **Compose** commands (`layer combine`, merge, apply): require `@namespace` (or a ULID) when more than one namespace exists for the same `type:name`.

Imported bodies are content-addressed under `~/.harnessdeck/blobs/sha256/…` with `content_hash` stored on the row.

### Unified composition model

A layer is an ordered list of attachments:

| Attachment | `resource list` | Attach example | Refresh |
| --- | --- | --- | --- |
| Material (`skill`, …) | yes | `layer combine L skill:foo@ns` | via `resource sync` when `origin_kind=marketplace_link` |
| `plugin` | yes | `layer combine L plugin:posthog@cursor-team-kit` | `resource sync plugin:posthog@cursor-team-kit` |
| `layer` | no | `layer combine L layer:backend-oncall@^1.0` | resolves to another local or published layer version |

Nested `layer` refs expand depth-first with cycle detection at apply time.

**Lazy plugin attach:** `layer combine plugin:…` links only. Sync is explicit via `resource sync`, `layer combine --sync`, or `project apply --sync-plugins`.

**Plugin resource metadata** (harness-agnostic):

```ts
interface PluginResourceMetadata {
  source_kind: "marketplace" | "local" | "git";
  marketplace_name?: string;
  version_constraint?: string;   // absent = floating latest
  resolved_version?: string;     // set by last successful sync
  sync_status?: "synced" | "stale" | "pinned" | "never_synced";
  portable?: "reference" | "embed";
  manifests?: { claude?: Record<string, unknown>; cursor?: Record<string, unknown> };
}
```

### Environment cascade

Composition resolves by ordered override (last wins):

```
home environment  ◂  layer default environment  ◂  deck active environment
```

On `project apply`, HarnessDeck merges environment fragments into layer serialization so env vars and model config override matching `type:name` resources. Home environments may be stored under `~/.harnessdeck/environments/<name>.json` (JSONC).

Switching deck active environment re-materializes how-values without reloading layer content — for example, moving from staging to prod while keeping the same layer stack.

### Hybrid deck repo layout

A deck ships as a git repo that is simultaneously a valid Claude **marketplace** (installable without HarnessDeck) and a carrier for the canonical bundle:

```
my-deck/
├─ .claude-plugin/marketplace.json
├─ <plugin-name>/.claude-plugin/plugin.json   # + harnessdeck.needs
├─ AGENTS.md · .cursor/rules/ · …             # generated native files
└─ .harnessdeck/
   ├─ deck.json                                # urn:harnessdeck:deck:v1
   └─ environments/<name>.json                 # non-secret values only
```

`.harnessdeck/deck.json` is the lossless source; marketplace and native files are **generated** and checked by deck doctor. See [Transport formats](#transport-formats).

### Progressive enhancement

| Consumer | What they get |
| --- | --- |
| Without HarnessDeck | `claude plugin install` and direct reads of `AGENTS.md` / `.cursor/rules/` |
| With HarnessDeck | Environment swap, cascade, cross-harness materialization, drift detection |

## Invocation and global options

The package publishes two binaries (`harnessdeck` and `hd`) pointing at the same entrypoint. Help text, usage lines, and follow-up hints use whichever name launched the process.

Global options:

| Flag | Behavior |
| --- | --- |
| `-V, --harnessdeck-version` | Print CLI version |
| `-v, --verbose` | Show stack traces on errors |
| `--no-color` | Disable ANSI colors (also respects `NO_COLOR`) |
| `--no-interactive` | Disable interactive prompts |
| `-h, --help` | Show help (`--help --all` includes hidden aliases) |

### Noun shorthand aliases

| Full noun | Alias |
| --- | --- |
| `layer` | `l` |
| `resource` | `r` |
| `project` | `p` |
| `harness` | `h` |
| `environment` | `e` |
| `cloud` | `c` |

## Command surface

Commands are grouped by noun. For flag-level detail see [docs/cli/command-reference.md](docs/cli/command-reference.md).

### Top-level commands

| Command | Current behavior |
| --- | --- |
| `harnessdeck init` | Creates `~/.harnessdeck/harnessdeck.db`, initializes the schema, seeds built-in layers, scans supported home-directory defaults, and optionally records global main/alias harness preferences. |
| `harnessdeck layer ...` | Layer CRUD, composition attach/detach, bundle export/import, cloud catalog workflows, diff, and doctor. |
| `harnessdeck deck ...` | Exports, imports, and validates portable deck repositories (`deck export`, `deck import`, `deck doctor`, `deck list`). |
| `harnessdeck migrate ...` | Exports or imports a machine-transfer archive. |
| `harnessdeck resource ...` | Lists, shows, deletes, and syncs canonical resources. |
| `harnessdeck project ...` | Scans projects, applies layers, syncs alias harnesses, inspects drift, lists snapshot history, reverts snapshots, and shows project status. |
| `harnessdeck harness ...` | Lists harness targets and manages global/project main/alias preferences. |
| `harnessdeck environment ...` | Creates and manages environments, environment values, secret refs, active-environment pointers, scoped capture/refresh, and cascade preview. |
| `harnessdeck cloud ...` | Authenticates with HarnessDeck Cloud and manages local cloud profiles. |

### `layer` subcommands

| Command | Current behavior |
| --- | --- |
| `layer create` | Creates a local layer with optional description, tags, and version. |
| `layer list` | Lists layers (`NAME`, `VERSION`, `DESCRIPTION` columns; `--show-id` optional). |
| `layer show` | Shows layer metadata, resources, dependencies, composition attachments, and default environment when set. |
| `layer combine` | Adds a composition attachment. Selectors may use `type:` prefixes (`skill:foo`, `plugin:posthog@mp`, `layer:baseline`) or `--type` when the prefix is omitted. Plugin attach is lazy by default; use `--sync` or `resource sync` to materialize install roots. |
| `layer uncombine` | Removes a typed attachment. |
| `layer delete` | Deletes a layer by selector. |
| `layer export` | Writes a portable JSONC layer export (`urn:harnessdeck:layer:v1`). |
| `layer import` | Imports a layer v1 file into the local database. |
| `layer search` | Searches remote catalogs through the configured cloud profile and connected org scopes. |
| `layer pull` | Downloads a published layer and imports it locally (`org/catalog/name[@version]`; `org/library[@version]` accepted during migration). Interactive remote search on TTY when no selector is provided. |
| `layer publish` | Publishes a local layer to a Cloud org **catalog** (requires organization, catalog name, and publish scope). |
| `layer catalog list` | Shows default catalog, connected orgs, connected layers, and effective cloud base URL. |
| `layer catalog connect org <slug>` | Opt in to public layers from another org in browse/search scope. |
| `layer catalog disconnect org <slug>` | Remove a connected org from scope (cannot remove `harnessdeck-cloud`). |
| `layer catalog connect layer <org>/<name>` | Opt in to one published layer without subscribing to the whole org. |
| `layer catalog disconnect layer <org>/<name>` | Remove a connected layer from scope. |
| `layer diff` | Compares two layers, or a layer and a bundle file. |
| `layer doctor` | Multi-check diagnostic (`--check`, `--list-checks`; exits `1` when invalid). |
| `layer from-project` | Scans a project and creates a layer from imported resources. |
| `layer set-environment` | Sets the default environment on the layer that `project apply` resolves for the given selector. |
| `layer unset-environment` | Clears the layer's default environment. |

### `environment` subcommands

| Command | Behavior |
| --- | --- |
| `environment create` | Creates an empty environment. |
| `environment list` | Lists environments with value counts and layer bindings. |
| `environment show` | Shows environment values, secret refs, and reverse references. |
| `environment delete` | Deletes an environment when unreferenced (or with `--force`). |
| `environment set` | Upserts environment values (`--var`, `--model`, `--permission`). |
| `environment unset` | Removes environment values. |
| `environment secret set` / `secret unset` | Manages secret references. |
| `environment import` / `export` | Reads or writes deck environment JSONC transport. |
| `environment use` | Sets the home or deck active environment pointer; `--reapply` opt-in re-runs last applied layers. |
| `environment active` | Shows active environment and cascade preview. |
| `environment resolve` | Dry-run merged environment values per cascade tier. |
| `environment capture` | Creates an environment from scoped project capture (see [Environment capture](#environment-capture)). |
| `environment refresh` | Updates an existing environment from scoped project capture. |

### `resource` subcommands

| Command | Current behavior |
| --- | --- |
| `resource list` | Lists canonical resources; shows `name@namespace` when namespace is non-empty. Hides `type=layer` composition refs by default; use `--all` to disable per-type caps. |
| `resource show` | Prints the full stored resource (supports selector grammar). |
| `resource sync` | Refreshes `plugin` resources and `marketplace_link` children from install roots. Supports `--on-conflict`, `--prune`, `--force`, `--dry-run`. |
| `resource delete` | Deletes a resource by selector or ID. |

### `project` subcommands

| Command | Current behavior |
| --- | --- |
| `project scan` | Detects harnesses, imports resources via hash-aware upsert, respects `.harnessdeckignore`, canonicalizes shared `AGENTS.md` instruction imports, prompts on TTY when content differs. Accepts plugin directories and marketplace manifests as scan sources. `--global` installs imported plugin sources into global harness locations. |
| `project apply` | Applies layer selectors, bundle paths, or bundle URLs; resolves environment cascade; serializes per platform; snapshots git-backed projects. Flags: `--strict-plugin-versions`, `--ignore-plugin-versions`, `--sync-plugins`. |
| `project drift` | Compares working tree against the latest apply/sync snapshot. |
| `project mirror` | Re-materializes alias harness outputs from the main harness reference. |
| `project history` | Lists stored snapshots (requires git-backed project). |
| `project revert` | Restores files from a snapshot. |
| `project status` | Shows harnesses, applied layers, snapshots, and harness preferences. |

### `harness` subcommands

| Command | Current behavior |
| --- | --- |
| `harness list` | Lists registered harness targets (`--supported` filters to natively serialized harnesses). |
| `harness set` | Sets global main/alias harness preferences (flags or interactive). |
| `harness status` | Shows the global harness preference record. |
| `harness project set` | Sets project-scoped main/alias harness preferences and materialization strategy. |
| `harness project status` | Shows project-scoped harness preferences. |

### `cloud` subcommands

| Command | Current behavior |
| --- | --- |
| `auth login [profile]` | Device authentication; saves a named local cloud profile. |
| `auth status` | Shows authenticated user/profile context. |
| `auth orgs` | Lists organizations; `--switch` updates the active org. |
| `auth logout` | Removes a local cloud profile. |

Remote catalog workflows live on **`layer`**, not `cloud`:

- `layer search` — search catalogs in scope
- `layer pull` — fetch a published layer + local import (distinct from `layer import` on a local file)
- `layer publish` — export bundle + upload a versioned layer to an org catalog

`project apply` resolves local layer names, bundle paths, and URLs. Published selectors (`org/catalog/name@version` or `org/name@version`) that are not installed locally are fetched from the catalog at apply time (same import path as `layer pull`).

### `migrate` subcommands

| Command | Current behavior |
| --- | --- |
| `migrate export <file>` | Exports local layers as bundle files plus harness preferences and config. |
| `migrate import <file>` | Imports a machine-transfer archive. |

## CLI UX contract

Human-readable output is the default. Automation uses explicit flags — output shape never changes based on TTY detection alone.

### Output modes

Structured read/report commands support:

- `--format human` (default)
- `--format json`

JSON coverage includes (non-exhaustive): `resource list|show`, `layer list|show`, `environment list|show|active|resolve`, `project status|history|drift`, `harness list|status`, `project apply --dry-run`, `init`, `auth status|orgs`, `layer doctor`, `migrate export|import`, `environment capture|refresh` with `--dry-run`.

Mutation commands return concise human verdict lines unless they already expose structured summaries useful to scripts.

### Selector rules

- **Environments:** name or ULID.
- **Local layers:** `name`, `name@version`, or ULID.
- **Published layers:** `org/catalog/name`, `org/catalog/name@version`, or ULID when stored locally after `layer pull`.
- During migration, `org/library[@version]` resolves as `org/<default-catalog>/library`.
- **Resources:** `name`, `type:name`, `type:name@namespace`, or ULID.
- **Snapshots:** full snapshot IDs in `project history`; `project revert` accepts the same ID.

Ambiguous selectors are errors. Human mode lists candidates; JSON mode returns a structured ambiguity payload. The CLI never silently picks the first match.

### Reusable identifiers

When human output supports follow-up commands, it includes canonical identifiers:

- `resource list --show-id` prints full resource IDs (hidden by default in list tables).
- `layer show` prints resource IDs in the resources sub-table when `--show-id` is set.
- `project history` prints full snapshot IDs.

### Error handling

| Situation | Behavior |
| --- | --- |
| Not found | Clear message, non-zero exit |
| Ambiguous selector | Non-zero exit; candidates in human or JSON mode |
| Invalid option | Explicit validation error, non-zero exit |
| Plugin version mismatch on apply (default) | Warning; apply continues |
| Plugin version mismatch with `--strict-plugin-versions` | Exit `2` |
| `--strict-plugin-versions` and `--ignore-plugin-versions` together | Error |

## Wizard mode

Several commands support wizard mode for interactive use: `layer pull`, `layer show`, `layer delete`, `layer combine`, `layer uncombine`, `layer from-project`, `layer set-environment`, `project apply`, `resource delete`, `environment create`, `environment capture`, `environment use`, `init`, `harness set`, and `harness project set`.

Wizard mode triggers when all of these are true:

1. stdin and stdout are TTYs.
2. `CI` is not `"true"`.
3. `HARNESSDECK_NO_INTERACTIVE` is not `"1"`.
4. `--no-interactive` is not present.
5. `--format json` is not requested.
6. The command was invoked with `--interactive`, or required positional input is missing.

When those conditions are not met, the CLI stays in explicit flag-and-argument mode.

## Human output

The CLI renders human mode through `src/ui/` primitives (`table`, `panel`, `diff`, `status`, `progress`). Design goals:

- One visual language across commands (semantic colors, `✓` / `⚠` / `✗` verdicts, boxed tables).
- List tables use uppercase muted headers and optional summary footers.
- Diff and drift output color rows by change kind (`+` / `−` / `~`).
- Spinners for long operations (`project scan`, `project apply`, `project mirror`, `resource sync`) resolve to verdict lines in TTY mode; JSON mode and non-TTY runs skip spinners.
- `--no-color` and `NO_COLOR` disable styling; box-drawing degrades to ASCII when not a TTY.

JSON output is unchanged by the visual layer.

## Initialization and harness selection

`harnessdeck init` is the explicit first-run flow. It:

1. Initializes the local database.
2. Discovers supported harness configuration in the user's home directory and imports findings.
3. Chooses the **main harness** and optional **alias harnesses** (interactive or via `--main` / `--aliases`).

Starter layers are **not** seeded locally. Apply catalog baselines with `project apply <name>` (bare names resolve against the public catalog) or install bundles with `layer pull`.

The main harness may differ from the first harness discovered on disk. Every later mirror operation uses one reference harness and a defined set of alias outputs.

After init, update preferences with `harness set` or `harness project set` (flags or interactive prompts).

## Storage and state

Persistent operational state lives in SQLite at `~/.harnessdeck/harnessdeck.db` (override with `HARNESSDECK_HOME`). The CLI creates the directory on demand and opens the database with WAL mode and foreign keys enabled.

### Configuration files

| Path | Purpose |
| --- | --- |
| `~/.harnessdeck/config.jsonc` | Toolkit configuration (JSONC comments allowed) |
| `~/.harnessdeck/cloud-profiles.json` | HarnessDeck Cloud profiles and tokens |
| `~/.harnessdeck/plugin-refresh-cache.json` | Internal refresh timestamps used during `resource sync` |
| `~/.harnessdeck/environments/<name>.json` | Named environment fragments (JSONC) |
| `~/.harnessdeck/blobs/sha256/…` | Content-addressed resource bodies |

Example `config.jsonc`:

```jsonc
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

Edit `config.jsonc` directly to tune toolkit options such as plugin refresh age.

### Schema (logical tables)

**Target model** (single layer table with optional `org_slug`, `catalog_slug`, composition attachments, and `default_environment_id`):

- `layers` — versioned capabilities (local or published identity).
- `layer_resources` — ordered attachments on a layer.
- `environments`, `environment_resources`, `environment_secret_refs` — named how-value bundles.
- `decks`, `deck_layers` — deck metadata and layer membership.
- `projects`, `project_layers` — tracked directories and applied layers.
- `resources` — canonical configuration items (including `plugin` and `layer` composition resource types).
- `harness_preferences`, `project_harnesses`, `snapshots`, `schema_version`.

### Project tracking

Project identity uses a normalized git `origin` remote. `project history`, `project drift`, `harness project set`, and `harness project status` require a git-backed project.

During `project scan`, `project apply`, and `project mirror`, HarnessDeck reads `origin`, normalizes it, and uses it as the durable key. The last known local path is stored for convenience.

### Snapshot behavior

Snapshots are created during `project apply` and `project mirror` when the target has a git origin. A snapshot stores the generated file map for the main harness and every alias harness materialized in that operation. `project revert` restores those files. `project drift` compares the latest snapshot to the working tree.

## Canonical model

### Resource types

`instruction`, `skill`, `rule`, `mcp_server`, `permission`, `hook`, `agent`, `command`, `env_var`, `model_config`, `plugin`, `layer`.

Metadata varies by type. See [Unified composition model](#unified-composition-model).

### Environment model

An environment has a unique `name`, description, ordered **environment values** (`env_var`, `model_config`, `permission` resources linked via `environment_resources`), and optional `environment_secret_refs` (`keychain`, `env`, or `file`). Secret values are not stored in deck transport.

### Environment capture

**Environment capture** creates or refreshes an environment from the current state of a project. It is distinct from **apply snapshots** stored during `project apply` / `project mirror`.

`environment capture` and `environment refresh` store only environment values **required by the layer stack in scope** — not the full machine environment:

1. Resolve scope: `--project` (required), `--layers` (default: project's last-applied layers).
2. Compute requirements from layer `needs[]`, MCP `env` keys, and (by default) agent model metadata in the merged stack.
3. Read values from project harness files first, then matching layer/resource rows, then `process.env[key]` for missing keys only.
4. Store non-secrets as `env_var` / `model_config` environment values; store likely secrets as secret references (`provider: env`), never literal secret values.
5. Missing required keys: warn and continue by default; `--strict` exits non-zero.

Permissions are captured only with `--include-permissions`.

Design detail: [docs/superpowers/specs/2026-06-07-environment-commands-design.md](docs/superpowers/specs/2026-06-07-environment-commands-design.md).

### Layer model

A **layer** is the primary composable unit.

**Body:**

- Ordered plugin-side **resources** (instructions, skills, rules, MCP servers, hooks, agents, commands).
- Composition attachments: `plugin` resource refs (marketplace/local) and `layer` resource refs (other layers, local or published).
- Optional Claude marketplace/plugin config and `needs[]` contract keys.
- Optional `default_environment_id` for environment cascade on apply.

**Identity:**

| Field | Local layer | Published layer |
| --- | --- | --- |
| `name` | required | required |
| `version` | required (semver) | required (immutable per publish) |
| `org_slug` | null | required |
| `catalog_slug` | null | required |
| `description`, `tags` | optional | optional |

**Behavior:**

- `project apply` resolves and materializes one or more layers (later layers override earlier for matching `type:name` keys).
- Nested `layer` refs expand depth-first; published refs resolve through catalog scope and semver constraints.
- Resource order is preserved during serialization.

**CLI selectors:** ULID; `name` (highest version wins locally); `name@version`; `org/catalog/name@version` for published layers.

**Implementation (SQLite v15):** composition and apply identity share one `layers` row per capability. `layer_resources` holds ordered attachments. Published identity uses `org_slug` / `catalog_slug` (empty strings for local layers).

### Deck model

A deck record has a `name`, optional `root_path`, optional `active_environment_id`, and ordered layer membership. On-disk source of truth: `.harnessdeck/deck.json` (`urn:harnessdeck:deck:v1`).

## Agent harness model

Harness support splits between a registry and serializers. The registry declares capability flags and default project/global paths. Serializers implement scan, canonicalization, aliasing rules, and write behavior.

### Native serializers

Dedicated serializers exist for `claude-code`, `codex`, `cursor`, `opencode`, `github-copilot`, and `copilot-cli`. Remaining registered harnesses use the generic serializer.

### Generic serializer

Other registered harnesses use the generic serializer with registry-declared paths.

### Registered harnesses

`harness list` is the executable source of truth (31 harness IDs at time of writing). `harness status` and `harness project status` report configured main and alias harness selection.

## Scan, apply, import, and sync behavior

The CLI favors deterministic file I/O over merge-heavy workflows.

### Scan

`project scan` detects harnesses by declared project paths, reads resources through serializers, and deduplicates within a run before upserting into SQLite (`origin_kind=local_snapshot`).

**Shared instruction canonicalization:** when multiple AGENTS-based platforms share one `AGENTS.md`, the scanner imports a single canonical instruction instead of per-platform `*-instructions` synthetic names. Rescans remove stale synthetic duplicates when content matches.

**`.harnessdeckignore`:** gitignore-style patterns at the project root exclude paths from project scan and `layer from-project`. Applies to project-derived flows only (not home-default discovery during `init`).

**Plugin sources:** scanning a plugin root (`.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`) or marketplace manifest snapshots plugin content into canonical resources. `--global` installs into each configured harness's global paths; `--harness` limits targets.

When one supported harness already exists in a project, it becomes the default main harness for that project.

### Apply

`project apply` accepts layer selectors, bundle files, or bundle URLs. Later layers override earlier ones for matching `type:name` resources, Claude config entries, and plugin refs. Environment cascade merges home, per-layer defaults, and deck-active fragments before serialization.

`layer` composition resources expand depth-first with cycle detection.

Plugin resources with `never_synced` or `stale` status warn by default; pass `--sync-plugins` to refresh before materialize.

When generated files already exist, `project apply` uses `--on-conflict replace|skip|prompt` (default: `prompt` on TTY, otherwise `replace`).

If no `--harness` list is passed, platforms are detected from the target directory. If none are detected, the command warns and does not write files.

### Project sync

`project mirror` materializes alias harness outputs from the main harness reference, preferring symlinks and falling back to copies. `--force-shift-reference` shifts the project's reference harness before syncing.

### Project drift

`project drift` loads the latest snapshot and reports added, modified, or deleted generated files.

### `resource sync`

For `type=plugin` resources:

1. Resolve marketplace or local install path.
2. Fetch or re-scan via `plugin-source-import`.
3. Update plugin metadata (`resolved_version`, `manifests`, `sync_status`).
4. Diff and upsert child resources in the plugin namespace.
5. On conflict, prompt on TTY or honor `--on-conflict overwrite|ignore|fail` (default `fail` when non-interactive).

Orphans are removed only with `--prune`.

## Transport formats

### Layer v1

Layer export/import uses JSONC with schema `urn:harnessdeck:layer:v1` and version `1`. Each export contains one **layer** payload (the top-level JSON key remains `layer` for transport compatibility), a flat `resources[]` list (including `plugin` and `layer` composition resources), optional `plugins[]` / `embedded_plugins[]`, optional `dependencies[]`, and optional top-level `claude` object. Missing optional arrays import as empty.

Internal database IDs, timestamps, `org_slug`, `catalog_slug`, and `source` fields are not exported from local export; publish adds org/catalog on upload. Import creates a local `layers` row and associated `layer_resources`.

Default export path: `<name>.harnessdeck.jsonc`.

### Deck v1 (canonical repo format)

`urn:harnessdeck:deck:v1` in `.harnessdeck/deck.json`:

```json
{
  "$schema": "urn:harnessdeck:deck:v1",
  "version": 1,
  "name": "my-deck",
  "layers": [
    {
      "name": "backend-oncall",
      "version": "1.0.0",
      "org": "acme",
      "catalog": "platform",
      "environment": "oncall-prod"
    }
  ],
  "environments": [
    { "name": "staging", "values": { "PD_REGION": "eu" } },
    { "name": "prod", "values": { "PD_REGION": "us" } }
  ],
  "active_environment": "staging"
}
```

Non-secret environment values may also live under `.harnessdeck/environments/<name>.json`. Deck doctor materializes and checks generated marketplace/native files against canonical `deck.json`. Layer entries reference layers by `name`, `version`, and optional `org`/`catalog` for published layers. Legacy `plugins[]` arrays are still accepted on import for backward compatibility.

### Machine transfer archives

`migrate export` writes JSON or tar.gz containing a manifest, exported layer bundles, the global harness preference record, and config. `migrate import` restores them. Archives do not include tracked project records, snapshots, or cloud profiles.

## HarnessDeck Cloud

HarnessDeck Cloud is the multiplayer control plane for **published layers**. An **organization** owns **catalogs**; each catalog holds versioned layers teams can search, review, and install. Deck repos remain the git transport format; catalogs are the default distribution surface.

Authentication stores named profiles in `~/.harnessdeck/cloud-profiles.json`.

- `auth login` performs device authentication.
- `auth status`, `auth orgs`, and `auth logout` manage profiles and active org context.
- `layer search`, `layer pull`, and `layer publish` use the selected cloud profile.

### Catalog scope

The CLI builds a **catalog scope** from:

| Source | Contents |
| --- | --- |
| Default catalog | Public layers in the `harnessdeck-cloud` org (always included) |
| Connected org | `layer catalog connect org <slug>` — public layers from that org |
| Connected layer | `layer catalog connect layer <org/name>` — opt-in to one published layer |
| Authenticated | Private and shared layers in orgs the user belongs to |

`layer search` and interactive `layer pull` query this union. Configuration persists under `catalog` in `~/.harnessdeck/config.jsonc`.

### Publish and install

| Action | Requires | Result |
| --- | --- | --- |
| `layer publish` | Cloud org, target **catalog**, publish scope | New immutable version under `org/catalog/name` |
| `layer pull` | Selector in catalog scope (or explicit `org/catalog/name@version`) | Local import of the published bundle |
| Solo local work | Neither org nor catalog | Layers exist only in local SQLite until published |

**Wire compatibility:** Cloud APIs today expose published layers as `org/library` entries (`layer_libraries` in HarnessDeck Cloud). Spec-wise, `library` is a published **layer name**; explicit `catalog` segments in selectors and APIs are the target shape. See [harnessdeck-cloud SPEC](../harnessdeck-cloud/SPEC.md).

Local integration behavior:

- Token refresh before remote calls; re-login guidance on refresh failure.
- No silent profile/org switching during other commands.
- `layer pull` fails on local name conflict instead of overwriting.

## Terminal demos (VHS)

Executable terminal demos supplement written scenarios in `docs/scenarios/`. Sources live under `docs/scenarios/vhs/tapes/`; rendered GIFs under `docs/scenarios/vhs/output/`. Regenerate with `bun run docs:vhs` (`scripts/generate-vhs-scenarios.sh`). Demos run against isolated fixture workspaces — not contributor home directories. VHS is not part of `bun run preflight`.

The primary walkthrough is a single adoption story (`init` → `project scan` → `resource list` → `layer list` → `project apply` → `project status`) embedded from the root README.

## Build, test, and release workflow

The project uses Bun for local dependency management, CI, and builds. Distribution is through the npm registry.

```bash
bun install
bun run lint
bun run typecheck
bun run test:run
bun run build
```

`tsup` builds the CLI from `src/index.ts` into `dist/` as a Node 20 ESM CLI with declaration files and a `#!/usr/bin/env node` banner. `prepublishOnly` runs `bun run build`.

## Known gaps and non-goals

- Remaining registered harnesses (beyond the six dedicated serializers) use path-driven generic serialization.
- `layer export` / `layer import` still operate on one layer export at a time; use `deck export --with-layer-bundles` and `deck import` for portable deck-repo round-trip.
- HarnessDeck does not host a plugin marketplace or wrap `claude plugin install|uninstall`.
