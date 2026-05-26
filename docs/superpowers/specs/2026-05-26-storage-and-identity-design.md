# Storage and Project Identity Design

## Problem

Three storage-and-identity issues have accumulated since the original SPEC:

1. **`project` is defined as a git-backed repository.** Today the SPEC and `models/project.ts` key project tracking on the normalized git origin URL. Folders without `git remote get-url origin` silently fall through every tracking surface (snapshots, drift, revert, project status), which is confusing and arbitrary — these features should work for any directory the user wants to manage.

2. **Presets are CLI-only artifacts.** Authoring or editing a preset today requires the CLI: `preset create`, then `preset add` once per resource, then `preset add-plugin` / `preset add-dependency` for each pin. Users who think in editors want to write a single file. The current bundle JSON export is portable but is not an authoring format — it is a snapshot of a database state.

3. **`init` is a discoverability papercut.** Every other command errors out or auto-creates the DB inconsistently; the user has to know to run `init` first. There is no `config` surface for the few user-tunable knobs (`plugins.refreshMaxAgeHours`).

This design covers the storage model and identity changes needed to fix these three. CLI surface and wizard ergonomics are in the companion spec `2026-05-26-cli-noun-and-wizard-design.md`.

## Goals

- Make `project` tracking work for any local directory, with or without a git remote.
- Provide a file-based authoring path for presets without abandoning SQLite for operational state.
- Make first-run feel native: no separate `init` command for users to discover.
- Clarify the **preset** vs **bundle** vocabulary across SPEC, README, and code comments.

## Non-Goals

- Rewriting projects, snapshots, plugin inventory, or harness preferences to YAML files. Operational state stays in SQLite.
- Changing the bundle schema identifier (`urn:harnessdeck:bundle:v1`).
- Replacing the existing `migrate export/import` machine-transfer flow.
- Cloud catalog format changes.

## Design Summary

Three independent changes, packaged together because they touch the same surfaces (SPEC concepts, init flow, project identity):

1. **Hybrid preset storage.** SQLite continues to hold operational state and a derived preset index. The *source of truth* for presets becomes `~/.harnessdeck/presets/<name>@<version>.yml`. On startup, the CLI scans that directory, reconciles its mtime/hash with the DB, and rebuilds preset rows when needed. `preset create/add/remove/...` continues to work and writes both the YAML and the DB; users who edit YAML directly trigger a re-import on the next CLI invocation.
2. **Stable project identity for non-git directories.** Project identity becomes a tuple of `(git_origin_normalized, local_id)` where `local_id` is a ULID written to `.harnessdeck/project.id` on first track. Git origin is still preferred when available; the marker file is the fallback. Both columns are nullable; one of them must be non-null for a project row to exist.
3. **Implicit init + `config` command group.** First-touch of `getDb()` from any command checks for the DB and auto-runs the init flow (silent for non-interactive sessions, one-line announce otherwise). A new `config show/set/reset` command group manages `~/.harnessdeck/config.yml`, replacing the JSON file as the canonical config (JSON still loadable for one minor version).

## Hybrid Preset Storage

### File layout

```
~/.harnessdeck/
├── harnessdeck.db                # Operational state (unchanged)
├── config.yml                    # User-tunable knobs (replaces config.json)
├── cloud-profiles.json           # Cloud auth (unchanged)
├── plugin-refresh-cache.json     # Plugin metadata cache (unchanged)
└── presets/
    ├── nextjs-fullstack@1.0.0.yml
    ├── python-fastapi@1.0.0.yml
    └── my-team@2.1.0.yml
```

Preset YAML files use this shape (one preset per file, matching the bundle schema's preset payload but indented and comment-friendly):

```yaml
$schema: urn:harnessdeck:preset:v1
name: my-team
version: 2.1.0
description: Team-wide Claude Code + Cursor baseline
tags: [team, baseline]

claude:
  marketplaces:
    team-plugins:
      source: { source: github, repo: org/claude-plugins }
      autoUpdate: true

# Each resource is either inlined here or referenced by content hash.
resources:
  - type: instruction
    name: project-context
    description: How we structure our repos
    content: |
      Use TypeScript strict mode.
      Prefer named exports.

  - type: skill
    name: brainstorming
    content_ref: sha256:7c1ec19b...   # See "Content references" below

plugins:
  - ref: formatter@team-plugins
    version: ^2.1.0
    embed_on_export: false

dependencies:
  - name: shared-baseline
    version: ^1.2.0
```

The file name is `<name>@<version>.yml`. Versions are part of the path so multiple versions of the same preset can coexist (matches the schema-v5 `UNIQUE(name, version)` constraint).

### Reconciliation: file → DB

On startup, after schema migration:

1. List `presets/*.yml`.
2. For each file: compute a content hash, compare with the row's `source_hash` column (new). If absent or different, parse and upsert the preset, its `preset_resources`, `preset_plugins`, and `preset_dependencies` rows inside a transaction.
3. For each DB row whose `source_path` no longer exists on disk: mark `source_present = 0`. Do **not** delete; this protects users who temporarily move or rename files.
4. Built-in presets (seeded by `seed-presets.ts`) are written to `presets/` on first init the same way user presets are. They are not special-cased anywhere except the seeding step.

Schema additions in migration `6`:

```sql
ALTER TABLE presets ADD COLUMN source_path  TEXT NOT NULL DEFAULT '';
ALTER TABLE presets ADD COLUMN source_hash  TEXT NOT NULL DEFAULT '';
ALTER TABLE presets ADD COLUMN source_present INTEGER NOT NULL DEFAULT 1;
```

### Reconciliation: DB → file

When the CLI mutates a preset (`preset create`, `preset add`, `preset remove`, `preset add-plugin`, etc.):

1. Apply the change to the DB inside a transaction.
2. Re-serialize the preset to `presets/<name>@<version>.yml`, overwriting atomically (write to `.tmp`, fsync, rename).
3. Update `source_hash` to match the new file.

If the YAML file was edited between CLI invocations *and* the user runs a CLI mutation, the file's content is loaded first (reconciliation step above), then mutated, then written back. There is never a state where the CLI silently overwrites a file with content that doesn't include the user's edits.

### Content references

Long resource bodies (skills, instructions) bloat preset files. The YAML format supports two forms:

- `content: "<inline string>"` — the body is embedded directly.
- `content_ref: "sha256:<hex>"` — the body lives in `~/.harnessdeck/blobs/sha256/<first-two>/<hex>` and the YAML file holds only the hash. The CLI writes blob files content-addressably; multiple presets can reference the same blob.

Both forms round-trip through bundle export — exports always inline content into the JSONC bundle (no blob refs leak across machines).

### Bundle export and import

Bundles remain the wire format for sharing and the cloud catalog. The format changes minimally:

- **Schema identifier:** still `urn:harnessdeck:bundle:v1`, still one preset per file.
- **Parsing:** the bundle parser switches from `JSON.parse` to a JSONC-aware parser (`jsonc-parser`). Strict JSON is a syntactic subset of JSONC, so every existing bundle parses unchanged. Authored bundles can now include `//` and `/* */` comments and trailing commas.
- **Emission:** `preset export` continues to emit minified strict JSON by default. A new `--pretty` flag emits indented JSON with leading comments (preset name, version, generated-at, source path).
- **YAML import:** `preset import` accepts `.yml`/`.yaml` files as well; the parser detects the extension. YAML export is not added in this change — keep one canonical wire format.

### Migration

The first CLI invocation after the upgrade:

1. Runs schema migration `6` (adds the three new columns).
2. For each preset already in the DB, writes `presets/<name>@<version>.yml` from the current row content.
3. Sets `source_path` and `source_hash` accordingly.
4. Logs `migrated N presets to ~/.harnessdeck/presets/`.

After this, the YAML files are the durable source. Users who do not edit files notice nothing.

## Project Identity Without Git

### Schema additions in migration `6`

```sql
ALTER TABLE projects ADD COLUMN local_id    TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN tracked_at  TEXT NOT NULL DEFAULT '';

-- One of (git_origin, local_id) must be non-empty.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_local_id
  ON projects(local_id) WHERE local_id != '';
```

`git_origin` stays `NOT NULL UNIQUE` in the current schema; migration `6` relaxes the `NOT NULL` (rebuild via the "create new, copy, drop, rename" pattern already used in migration `5`) so a project can be keyed on `local_id` alone.

### Tracking flow

When `project scan`, `project apply`, or `project sync` runs against `<path>`:

1. Try `getGitOrigin(path)`. If it returns a URL, normalize and use it as the durable key (current behavior).
2. Else: check for `<path>/.harnessdeck/project.id`.
   - If present: read the ULID; that is the durable key.
   - If absent: do nothing automatically. The CLI prints a one-line hint:
     > `→ this directory is not git-tracked. Run \`hd project track\` to enable snapshots/drift/revert.`
3. `hd project track [path]` is the new explicit opt-in:
   - Writes a ULID to `<path>/.harnessdeck/project.id`.
   - Adds the path to `.gitignore` *only if* the directory is also a git repo with no origin (avoids polluting non-git directories with a `.gitignore` change).
   - Inserts a project row keyed on the ULID.
   - Subsequent scan/apply/sync see the marker and track normally.

The `.harnessdeck/` directory at the project root is the new project-local state location. It currently does not exist; this design introduces it. Apart from `project.id`, nothing else lives there yet.

### Why a marker file and not a path-based hash?

Path-based identity (e.g. `sha256(realpath(.))`) was considered. It was rejected because moving or renaming a tracked directory should not orphan its snapshots — exactly the kind of fragility git origins avoid. A ULID marker survives rename. The trade-off: deleting `.harnessdeck/project.id` orphans the row; that is acceptable because the file is small and grep-able, and `project track` is idempotent.

### Backwards compatibility

- Git-tracked projects are unchanged. Their rows have `git_origin` set and `local_id = ''`.
- New non-git projects opted in via `project track` have `local_id` set and `git_origin = ''`.
- If a git repo later gains an origin and is re-scanned, the existing `local_id` row is migrated by updating `git_origin` on it. The reverse (origin removed) is not supported automatically — the user runs `project track` to pin a ULID.

## Implicit Init and the `config` Command

### Auto-init

`getDb()` in `src/db/connection.ts` is the single entry point. New behavior:

1. If the DB file exists: open it, run `initializeSchema()` (idempotent), return.
2. If the DB file does not exist:
   - Check `HARNESSDECK_NO_AUTO_INIT`. If set, throw with a clear message: `Database not found at ~/.harnessdeck/harnessdeck.db; run \`hd init\` first.`
   - Otherwise: run the equivalent of `handleInitCommand({ interactive: false })` silently for non-TTY, or with one announce line for TTY:
     > `→ first run — initializing ~/.harnessdeck (1 main harness, 0 aliases). Run \`hd harness set\` to change defaults.`
   - Then continue with the original command.

The explicit `hd init` command remains, with a `--force` flag that resets the database and re-seeds. It is no longer the only way to bootstrap.

### `hd config`

A new top-level command group:

| Command | Behavior |
| --- | --- |
| `hd config show` | Prints the effective config (merge of defaults + `~/.harnessdeck/config.yml`). Supports `--format json`. |
| `hd config set <key> <value>` | Sets one key. Supports dotted paths (e.g. `plugins.refreshMaxAgeHours`). Validates against the config schema; rejects unknown keys with a helpful message. |
| `hd config reset` | Removes `~/.harnessdeck/config.yml`. Does not touch the DB, presets, snapshots, or cloud profiles. Asks for confirmation unless `--yes` is set. |

### `config.yml`

Same content as today's `config.json`, written in YAML:

```yaml
# ~/.harnessdeck/config.yml
plugins:
  refreshMaxAgeHours: 24
```

The config schema is documented in the SPEC's "Storage and state" section. For one minor version, the CLI reads both `config.yml` and `config.json` (YAML wins if both exist) and writes `config.yml` on every mutation. After that minor version, `config.json` becomes unsupported with a clear error message and migration hint.

## Concept Clarification: Preset vs Bundle

The SPEC and README use "bundle" for at least three things today. Codify the split:

- **Preset** — the *conceptual* collection of resources, plugin pins, dependencies, and Claude config. Always identified by `(name, version)`. Lives in `~/.harnessdeck/presets/<name>@<version>.yml` (source of truth) and as a derived row in the `presets` table.
- **Preset bundle** — a *portable serialized form of one preset* (JSONC, schema `urn:harnessdeck:bundle:v1`). Used for `preset export`, `preset import`, `preset install` (cloud download), `preset publish` (cloud upload), and the `project apply <bundle-path-or-url>` flow.
- **Migration archive** — a tar.gz or JSON file produced by `migrate export`, containing many preset bundles plus the global harness preference record and `config.yml`. Never call this a "bundle"; it is an archive.

SPEC.md and README.md text is updated as part of the implementation; the README diagram (added by the companion spec) renders this distinction visually.

## Schema Changes Summary

Migration `6` adds:

```sql
-- Preset source-of-truth tracking
ALTER TABLE presets ADD COLUMN source_path    TEXT NOT NULL DEFAULT '';
ALTER TABLE presets ADD COLUMN source_hash    TEXT NOT NULL DEFAULT '';
ALTER TABLE presets ADD COLUMN source_present INTEGER NOT NULL DEFAULT 1;

-- Non-git project identity. Requires rebuild because git_origin loses NOT NULL.
CREATE TABLE projects_new (
  id          TEXT PRIMARY KEY,
  git_origin  TEXT NOT NULL DEFAULT '',
  local_id    TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  local_path  TEXT NOT NULL DEFAULT '',
  tracked_at  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  CHECK (git_origin != '' OR local_id != '')
);

INSERT INTO projects_new (id, git_origin, local_id, name, local_path, tracked_at, created_at)
  SELECT id, git_origin, '', name, local_path, created_at, created_at FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

CREATE UNIQUE INDEX idx_projects_git_origin ON projects(git_origin) WHERE git_origin != '';
CREATE UNIQUE INDEX idx_projects_local_id   ON projects(local_id)   WHERE local_id != '';
```

The `projects` rebuild follows the same `PRAGMA foreign_keys = OFF` / transaction / restore pattern as migration `5` because `project_presets`, `snapshots`, `project_harnesses`, and `project_plugin_state` all `ON DELETE CASCADE` on it.

## Testing Strategy

- Preset YAML round-trip: write → read → DB → re-write produces byte-identical YAML (modulo formatting normalization).
- Built-in preset seed writes both DB rows and YAML files on first init.
- Edit-then-mutate flow: edit `presets/my-team@1.0.0.yml` outside the CLI, run `hd preset add my-team ...`, verify the file's prior edits are preserved.
- Non-git `project track` creates `.harnessdeck/project.id` and registers a `local_id`-keyed row.
- Renaming a tracked non-git project directory still resolves to the same project row.
- Auto-init bootstraps the DB on a fresh machine; `HARNESSDECK_NO_AUTO_INIT` blocks it.
- `config show/set/reset` round-trips YAML; reset deletes file but leaves DB intact.
- JSONC bundle parsing: existing JSON bundles parse unchanged; bundles with comments and trailing commas parse correctly.

## Documentation Changes

- SPEC.md "Core concepts" gains a paragraph each on preset vs bundle and project identity.
- SPEC.md "Storage and state" replaces the JSON config example with a YAML one and adds the `presets/` directory.
- README "Where data lives" mirrors the SPEC change and adds a one-paragraph note on `.harnessdeck/project.id`.
- The mermaid diagram in the companion spec covers the relationship between preset YAML files, the DB-derived preset row, the exported bundle, and the snapshot.

## Implementation Notes

Phasing keeps risk low:

1. Migration `6`: schema changes only. No behavior change. Verify schema upgrade tests pass.
2. YAML preset I/O (read, write, reconcile) + built-in preset seed change to write files. Hidden behind a feature flag in `config.yml` (`presets.yamlSource: true`) for one minor version; default off.
3. Promote the YAML source to default; old DB-only flow becomes a one-time migration step.
4. Non-git `project track` command and the marker file flow.
5. Auto-init in `getDb()` plus `config show/set/reset`.
6. JSONC bundle parser swap.

Each step preserves a working `preflight` (`bun run lint && bun run typecheck && bun run test:run && bun run build`) and ships independently.
