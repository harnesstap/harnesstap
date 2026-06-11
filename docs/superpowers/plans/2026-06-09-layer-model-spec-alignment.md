# Layer model spec alignment plan

Align HarnessDeck CLI storage and commands with the unified **layer** model in `SPEC.md` (Layer model section).

## Phase 1 — Terminology and selectors (done)

- CLI keeps `hd layer` command name.
- Catalog selectors: `name`, `name@version`, `org/name[@version]`, `org/catalog/name[@version]` (`src/services/layer-selector.ts`).
- Types distinguish material resources from composition resources (`plugin`, `layer`).

## Phase 2 — Composition resources (done)

- `resources` table supports `type=plugin` and `type=layer` with namespace/origin metadata.
- Plugin pins and layer dependencies stored as composition resources on plugin rows (pre-v15).
- Migration 14 converts legacy pin/dependency tables to composition resources.

## Phase 3 — SQLite schema v15 (done)

Unify `plugins` + `configured_layers` into `layers` + `layer_resources`.

1. **`SCHEMA_VERSION = 15`** in `src/db/schema.ts`
2. **New tables:**
   - `layers`: id, name, version, org_slug (`''` local), catalog_slug (`''` local), description, tags, claude_config, needs_config, default_environment_id, created_at, updated_at; `UNIQUE(org_slug, catalog_slug, name, version)`
   - `layer_resources`: layer_id, resource_id, order
   - `deck_layers` (replaces `deck_configured_layers`), `project_layers` (replaces `project_configured_layers`)
3. **Data migration** (`src/db/migrate-to-unified-layers.ts`):
   - Each `configured_layer` → one `layers` row
   - Single plugin: copy fields + resources
   - Multi-plugin: merge using `layer-merge` logic
   - Orphan plugins → standalone `layers` rows
   - Rewire deck/project FKs; drop old tables
4. **Models:** `src/models/layer-model.ts` canonical; `plugin-component.ts` and `configured-layer.ts` thin compat shims
5. **Services:** `configured-layer-merge.ts` → `layer-apply-merge.ts`; update exporter, composition-resource, layer-doctor, layer-diff, layer-validate, environment services, `index.ts` project apply
6. **Types:** `Layer` with `org_slug`, `catalog_slug`, `default_environment_id` in `src/types.ts`

## Phase 4 — Cloud identity on local layers

### 4.1 `layer add` (done)

After remote install, stamp `org_slug` and `catalog_slug` on the imported local layer row.

### 4.2 `layer publish` (done)

After successful publish, update local layer published identity (`org_slug`, `catalog_slug`, version when returned).

### 4.3+ (done — shipped in [2026-06-10-spec-follow-up.md](./2026-06-10-spec-follow-up.md) / harnessdeck#40)

- Resolve published layers from catalog during apply (done)
- Deck export/import uses selector-only layer entries with legacy `plugins[]` import compat (done)
- Secret dereferencing at apply for `env` and `file` providers (done; keychain deferred)

## Tests

- `test/db/migrate-to-unified-layers.test.ts` — migration scenarios
- `test/db/schema.test.ts` — expect v15 tables
- Full suite: `bun run test:run`
- `bun run typecheck`

## Constraints

- No inline imports; exhaustive switch on unions
- Keep `hd layer` command name
- Preserve Phase 2 catalog selectors
- Do not commit junk (`.claude/settings.json`)
