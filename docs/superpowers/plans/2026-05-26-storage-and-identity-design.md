# Storage and Identity Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement JSONC-backed preset/config storage, non-git project identity, and auto-init/config CLI behavior from `docs/superpowers/specs/2026-05-26-storage-and-identity-design.md`.

**Architecture:** Keep SQLite as operational state, but add JSONC file surfaces for authored presets and config. Introduce migration `6` to extend preset and project schemas, then layer reconciliation/services on top so CLI commands can keep DB state and filesystem state in sync. Project tracking becomes identity-driven rather than git-only by adding a local marker file fallback used by scan/apply/status/drift/sync/history.

**Tech Stack:** TypeScript, Bun, Commander, better-sqlite3, Bun test, filesystem APIs, `jsonc-parser`, `ulid`, semver.

**Spec:** [docs/superpowers/specs/2026-05-26-storage-and-identity-design.md](../specs/2026-05-26-storage-and-identity-design.md)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/db/schema.ts` | Migration `6` for preset source tracking and project identity columns/indexes |
| `src/db/connection.ts` | Auto-init entrypoint and shared HarnessDeck path helpers |
| `src/config/settings.ts` | Read/write effective config from `config.jsonc` with `config.json` fallback |
| `src/types.ts` | Extend preset/bundle/project types for multi-preset bundles and local IDs |
| `src/models/preset.ts` | Persist preset source metadata and version-aware queries needed for reconciliation |
| `src/models/project.ts` | Upsert/look up projects by git origin or `local_id` |
| `src/models/plugin.ts` | Keep preset plugin CRUD available to file reconciliation/import/export |
| `src/services/exporter.ts` | JSONC-aware bundle parse/write, legacy single-preset compatibility, multi-preset import/export |
| `src/services/seed-presets.ts` | Seed built-ins through the same preset file source path |
| `src/services/preset-source.ts` | JSONC preset file paths, read/write/reconcile logic, blob refs, serialization |
| `src/services/git.ts` | Existing git-origin helpers plus project marker fallback hooks |
| `src/services/project-identity.ts` | Resolve project key from git origin or `.harnessdeck/project.id`, create marker on `project track` |
| `src/services/project-sync.ts` | Use identity-aware project lookups instead of git-only registration |
| `src/services/project-drift.ts` | Keep drift working for `local_id` tracked projects |
| `src/services/migrate.ts` | Export/import `config.jsonc` and JSONC bundle filenames |
| `src/index.ts` | Auto-init integration, `config` group, `project track`, preset export/import updates, identity-aware project commands |
| `test/db/schema.test.ts` | Migration `6` coverage |
| `test/config/settings.test.ts` | JSONC config read/fallback tests |
| `test/services/exporter.test.ts` | JSONC bundle parse/write and multi-preset round-trip tests |
| `test/services/seed-presets.test.ts` | Built-in preset seeding writes files and DB state |
| `test/services/project-identity.test.ts` | Marker creation, rename survival, git-origin migration tests |
| `test/cli/export-import.test.ts` | CLI JSONC bundle export/import behavior |
| `test/cli/scan.test.ts` | Non-git scan guidance and tracked local-id behavior |
| `test/cli/planned-scenarios.test.ts` | Drift/sync/history behavior with non-git tracking |
| `test/cli/config.test.ts` | `config show/set/reset` coverage |

---

### Task 1: Migration 6 and config JSONC foundations

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/db/connection.ts`
- Modify: `test/db/schema.test.ts`
- Modify: `test/config/settings.test.ts`

- [ ] **Step 1: Write failing schema tests for migration 6**

Add assertions that schema version becomes `6`, `presets` gets `source_path`, `source_hash`, `source_present`, and `projects` gets `local_id` / `tracked_at` plus the partial unique index on `local_id`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/db/schema.test.ts`
Expected: FAIL because version is still `5` and new columns/indexes do not exist.

- [ ] **Step 3: Implement migration 6 in `src/db/schema.ts`**

Add the preset columns with defaults, rebuild `projects` so `git_origin` is no longer the only identity key, keep the existing foreign-key toggle pattern used by migration `5`, and bump `SCHEMA_VERSION` to `6`.

- [ ] **Step 4: Write failing config JSONC tests**

Extend `test/config/settings.test.ts` to cover:

```ts
it("prefers config.jsonc over config.json", () => {
  // write both files, expect JSONC value to win
});

it("reads JSONC comments and trailing commas", () => {
  // config.jsonc contains comments and trailing comma
});
```

- [ ] **Step 5: Run config tests to verify failure**

Run: `bun test test/config/settings.test.ts`
Expected: FAIL because loader only reads strict `config.json`.

- [ ] **Step 6: Implement JSONC config loading and path helpers**

Update `src/config/settings.ts` to read `config.jsonc` first, then `config.json`, parse JSONC, and return defaults on invalid content. In `src/db/connection.ts`, add helpers for the config path and auto-init checks that later CLI code can call without duplicating path logic.

- [ ] **Step 7: Run targeted tests to verify pass**

Run: `bun test test/db/schema.test.ts test/config/settings.test.ts`
Expected: PASS.

---

### Task 2: JSONC bundle parsing and multi-preset bundle support

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/exporter.ts`
- Modify: `src/services/preset-source.ts`
- Modify: `src/services/seed-presets.ts`
- Modify: `test/services/exporter.test.ts`
- Modify: `test/cli/export-import.test.ts`

- [ ] **Step 1: Write failing exporter tests for JSONC parsing**

Add tests that import a bundle with comments/trailing commas and that export/import a bundle containing two presets while preserving shared embedded plugins.

- [ ] **Step 2: Run exporter tests to verify failure**

Run: `bun test test/services/exporter.test.ts`
Expected: FAIL because `JSON.parse` rejects JSONC and bundle types only support a single `preset` payload.

- [ ] **Step 3: Extend bundle types and parser/writer behavior**

In `src/types.ts`, add a multi-preset bundle representation that still preserves legacy single-preset fields. In `src/services/exporter.ts`, switch parsing to JSONC, add helpers to normalize legacy and multi-preset bundles into a shared internal representation, keep single-preset export in legacy shape, and emit a `presets` array when more than one preset is exported.

- [ ] **Step 4: Update preset bundle source helpers**

Allow `.jsonc` bundle file paths in `src/services/preset-source.ts`, and ensure temp remote downloads use a `.jsonc` filename.

- [ ] **Step 5: Update built-in preset seeding to use shared bundle parser**

Teach `src/services/seed-presets.ts` to parse built-in preset bundles through the same JSONC-aware importer logic rather than bespoke `JSON.parse` handling.

- [ ] **Step 6: Extend CLI export/import tests**

Add a CLI test that exports to a `.jsonc` path and successfully re-imports a commented bundle file.

- [ ] **Step 7: Run targeted tests to verify pass**

Run: `bun test test/services/exporter.test.ts test/cli/export-import.test.ts test/services/seed-presets.test.ts`
Expected: PASS.

---

### Task 3: Preset file source-of-truth reconciliation

**Files:**
- Modify: `src/models/preset.ts`
- Modify: `src/models/plugin.ts`
- Modify: `src/services/preset-source.ts`
- Modify: `src/services/seed-presets.ts`
- Create: `test/services/preset-source.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Cover these flows:

1. DB preset migrates to `~/.harnessdeck/presets/<name>.jsonc` and records `source_path` / `source_hash`.
2. Editing a preset JSONC file and invoking reconciliation updates that `(name, version)` row.
3. Mutating an older version updates the DB but leaves the authored file untouched.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test test/services/preset-source.test.ts`
Expected: FAIL because no reconciliation or preset-file writer exists.

- [ ] **Step 3: Add preset source metadata to model rows**

Extend `PresetRow` and public preset queries with `source_path`, `source_hash`, and `source_present`. Add helpers to fetch all versions for a preset name and to update source metadata transactionally.

- [ ] **Step 4: Implement preset file read/write/reconcile service**

In `src/services/preset-source.ts`, implement:

1. Preset directory path helpers.
2. JSONC serializer for authored preset files.
3. Atomic write for `presets/<name>.jsonc`.
4. Startup reconciliation by hash/path.
5. Version-aware note behavior when mutating non-authored versions.

- [ ] **Step 5: Use the reconciliation service from built-in seeding**

Seed built-in presets through the same writer path so they land in `~/.harnessdeck/presets/` on first init.

- [ ] **Step 6: Run tests to verify pass**

Run: `bun test test/services/preset-source.test.ts test/services/seed-presets.test.ts`
Expected: PASS.

---

### Task 4: Non-git project identity and `project track`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/models/project.ts`
- Create: `src/services/project-identity.ts`
- Modify: `src/services/project-sync.ts`
- Modify: `src/services/project-drift.ts`
- Modify: `src/index.ts`
- Create: `test/services/project-identity.test.ts`
- Modify: `test/cli/scan.test.ts`
- Modify: `test/cli/planned-scenarios.test.ts`

- [ ] **Step 1: Write failing tests for local-id tracking**

Add service tests for creating `.harnessdeck/project.id`, resolving a tracked project after directory rename, and migrating an existing local-id row to a git-origin row when an origin later appears.

- [ ] **Step 2: Run service tests to verify failure**

Run: `bun test test/services/project-identity.test.ts`
Expected: FAIL because there is no marker-file identity flow.

- [ ] **Step 3: Implement identity-aware project model/service**

Add model queries and upserts by origin or `local_id`, then implement `src/services/project-identity.ts` helpers to:

1. Resolve identity from git origin or `.harnessdeck/project.id`.
2. Create the marker file and optional `.gitignore` update on `project track`.
3. Upsert or migrate the DB row appropriately.

- [ ] **Step 4: Wire scan/apply/status/drift/sync/history to the new identity service**

Replace git-only short-circuit behavior in `src/index.ts`, `src/services/project-sync.ts`, and related handlers. Non-git untracked directories should print the track hint; tracked directories should fully participate in snapshots, drift, revert, and status.

- [ ] **Step 5: Add CLI coverage**

Extend CLI tests so:

1. `project scan` on a non-git folder prints the tracking hint.
2. `project track` registers the directory.
3. `project status` / `project drift` continue to work after renaming the tracked directory.

- [ ] **Step 6: Run targeted tests to verify pass**

Run: `bun test test/services/project-identity.test.ts test/cli/scan.test.ts test/cli/planned-scenarios.test.ts`
Expected: PASS.

---

### Task 5: Auto-init and `config` CLI commands

**Files:**
- Modify: `src/db/connection.ts`
- Modify: `src/index.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/services/migrate.ts`
- Create: `test/cli/config.test.ts`

- [ ] **Step 1: Write failing CLI tests for auto-init and config commands**

Cover:

1. Any DB-using command auto-initializes on a fresh home.
2. `HARNESSDECK_NO_AUTO_INIT=1` blocks auto-init with a clear error.
3. `config show`, `config set plugins.refreshMaxAgeHours 48`, and `config reset --yes` work against `config.jsonc`.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test test/cli/config.test.ts`
Expected: FAIL because there is no auto-init or `config` command group.

- [ ] **Step 3: Implement auto-init in `getDb()` call path**

Make `src/db/connection.ts` detect missing DB files and trigger schema/bootstrap setup unless disabled. Keep explicit `init` intact, but stop requiring it for first use.

- [ ] **Step 4: Implement `config show|set|reset` CLI behavior**

Add a top-level `config` command group in `src/index.ts`, validate dotted keys against the known settings shape, write JSONC on set, and require confirmation on reset unless `--yes` is provided.

- [ ] **Step 5: Update migration export/import to use `config.jsonc`**

Ensure exported migration archives carry `config.jsonc`, while import still tolerates older `config.json` archives.

- [ ] **Step 6: Run targeted tests to verify pass**

Run: `bun test test/cli/config.test.ts test/config/settings.test.ts test/cli/export-import.test.ts`
Expected: PASS.

---

### Task 6: Documentation and final verification

**Files:**
- Modify: `SPEC.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-26-storage-and-identity-design.md` (only if implementation-required clarifications are needed)

- [ ] **Step 1: Update terminology and storage docs**

Document `preset` vs `bundle`, `config.jsonc`, `~/.harnessdeck/presets/`, and `.harnessdeck/project.id` in `SPEC.md` and `README.md`.

- [ ] **Step 2: Run focused verification**

Run: `bun test test/db/schema.test.ts test/config/settings.test.ts test/services/exporter.test.ts test/services/preset-source.test.ts test/services/project-identity.test.ts test/cli/config.test.ts test/cli/export-import.test.ts test/cli/scan.test.ts test/cli/planned-scenarios.test.ts`

- [ ] **Step 3: Run project preflight**

Run: `bun run preflight`
Expected: All checks pass, or document any unrelated pre-existing failures if they persist.
