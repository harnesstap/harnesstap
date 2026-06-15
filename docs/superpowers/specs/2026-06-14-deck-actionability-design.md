# Deck actionability design

**Date:** 2026-06-14  
**Status:** Approved for implementation  
**Audience:** Solo developers (SQLite curation) and teams (git deck repos) equally  
**Related:** [SPEC.md](../../../SPEC.md), [TOML transport](2026-06-14-toml-transport-design.md), [onboarding improvements](2026-06-14-onboarding-improvements-design.md)

## Problem

Decks are modeled in SQLite (`decks`, `deck_layers`) and documented as the curated layer stack plus environments for git transport. The CLI surface is incomplete:

| Capability | Model / service | CLI today |
| --- | --- | --- |
| List decks | `listDecks()` | `deck list` |
| Export / import repo | `exportDeckRepo`, `importDeckRepo` | `deck export`, `deck import` |
| Validate repo | `runDeckDoctor` | `deck doctor` |
| Show membership | `exportDeckToDeckJson`, `listDeckLayers` | **missing** |
| Delete record | `deleteDeck()` | **missing** |
| Apply stack | `mergeConfiguredLayers` + `project apply` | **missing** (manual layer list only) |
| Materialize marketplace | `materializeDeckRepo` | **missing** (doctor hints only) |
| Curate membership | `addLayerToDeck`, `removeLayerFromDeck` | **missing** |

Users cannot answer “what’s in this deck?”, “apply this deck to my project”, or “remove this stale deck record” without reading `deck.toml` or touching SQLite.

The product chain is **resource → layer → deck → apply**, but apply only accepts layers. Deck participates in apply only indirectly via environment cascade when the project path matches a deck `root_path` or contains `.harnessdeck/deck.toml`.

## Goals

1. **See** — inspect deck metadata, ordered layer stack, environments, and active environment from the CLI.
2. **Apply** — apply layers and decks from their own noun groups (`layer apply`, `deck apply`) with the same materialize/snapshot behavior as today’s `project apply`.
3. **Lifecycle** — delete deck records safely without deleting layers or on-disk repos.
4. **Curate (phase 2)** — add/remove layers and set active environment in the DB; optional write-back to `deck.toml` when `root_path` is set.
5. **Publish (phase 2)** — expose `deck materialize` for hybrid marketplace repos.
6. **Docs** — add `deck` to command reference; canonical examples use `layer apply` / `deck apply`; `project apply` documented as compatibility alias.

## Non-goals

- Deleting layers or environments when deleting a deck.
- Deleting on-disk deck repo directories from `deck delete`.
- A separate apply implementation (must reuse `handleApplyCommand` / `mergeConfiguredLayers`).
- `project apply` with no arguments auto-reading cwd `deck.toml` (too magical for phase 1).
- `bundle:v1` single-file apply (phase 3 / separate spec).
- `deck create` in phase 1 (`deck import` and import paths already create records).

## Personas

| Persona | Primary workflow | Phase 1 unblock | Phase 2 unblock |
| --- | --- | --- | --- |
| **Solo** | Import or build layers in SQLite, stack them into a deck, apply to various project paths | `deck show`, `deck apply`, `layer apply`, `deck delete` | `deck add-layer` / `remove-layer`, `set-environment` |
| **Team** | Maintain a git deck repo; others clone and install via Claude marketplace | `deck show` after import, `deck apply` | `deck materialize`, optional `deck.toml` write-back on curation |

## Phased delivery

### Phase 1 — Operable deck (ship first)

| Command | Behavior |
| --- | --- |
| `deck show <name>` | Name, id (with `--show-id`), `root_path`, active environment, table of layers in order (`ORDER`, `NAME`, `VERSION`, `ORG/CATALOG`, layer default env). JSON via `--format json`. |
| `deck delete <name>` | Delete `decks` row and `deck_layers` links (FK cascade). Layers, environments, and files unchanged. Warn when `root_path` is non-empty; `--force` skips confirmation on TTY. Wizard on TTY when name omitted (mirror `layer delete`). |
| `layer apply <layer...>` (`l apply`) | **Canonical** layer apply entry. Same handler as today’s `project apply`: one or more layer selectors, layer export path, or URL. All harness/plugin/dry-run flags unchanged. `--project` defaults to `.`. |
| `deck apply <deck> [layer...]` | **Canonical** deck apply entry. Expand deck to ordered layer selectors; append optional positional layers for overrides. Same flags as `layer apply`. |
| `project apply` | **Compatibility alias** for `layer apply` only. If user passes `--deck`, exit with hint: `use deck apply <name> instead`. Deprecation warning on stderr in human mode (not in JSON). |

### Phase 2 — Curation and publish

| Command | Behavior |
| --- | --- |
| `deck add-layer <deck> <layer...>` | Append layers to `deck_layers` order; error if already member. `--write` updates `.harnessdeck/deck.toml` when `deck.root_path` resolves and file exists. |
| `deck remove-layer <deck> <layer...>` | Remove from `deck_layers`. `--write` syncs `deck.toml`. |
| `deck set-environment <deck> <environment>` | Set `active_environment_id`. `--write` syncs `deck.toml`. |
| `deck unset-environment <deck>` | Clear active environment. `--write` syncs `deck.toml`. |
| `deck materialize <path>` | Read `deck.toml` (+ resolve layers from DB or sidecar exports), run `materializeDeckRepo`, regenerate marketplace and native plugin files. `--dry-run` lists paths that would change. |

### Phase 3 — Transport polish (defer)

- `project apply <bundle.harnessdeck.toml>` for `urn:harnessdeck:bundle:v1`.
- VHS tapes for scenarios 29–30 (walkthrough text shipped).
- Optional `deck sync <path>` as alias for `deck import` when repo already linked.

## Design details

### Resolving a deck for apply

New service: `resolveDeckLayerSelectors(deckSelector: string): string[]`

1. Resolve deck by ULID or `getDeckByName`.
2. `listDeckLayers(deckId)` ordered by `"order"`.
3. For each link, load layer row; build selector:
   - Published: `org/catalog/name@version` when `org_slug` and `catalog_slug` set.
   - Else: `name@version`.
4. Return ordered selector list.

Shared `handleApplyCommand` (invoked from `layer apply`, `deck apply`, and compat `project apply`):

- **`layer apply`:** positional args are layer selectors / export paths / URLs.
- **`deck apply`:** first positional is deck name/ID; remaining positionals are optional override layers appended after deck expansion.
- **`deck apply`:** `resolvedLayerNames = [...resolveDeckLayerSelectors(deck), ...overrideLayers]`; pass `deckId` into environment cascade.
- Error if resolved list is empty.

Layer resolution per selector reuses `resolveApplyLayerSource` (catalog fetch, bare names, local selectors) — no new fetch path.

### Environment cascade with `--deck`

Extend `ResolveEnvironmentCascadeForApplyInput`:

```ts
interface ResolveEnvironmentCascadeForApplyInput {
  configuredLayerIds: string[];
  projectRoot: string;
  deckId?: string;  // new
}
```

`buildEnvironmentCascadeInput` calls `loadDeckActiveEnvironmentFragment(projectRoot, deckId)`.

Priority when `deckId` is passed:

1. Deck row `active_environment_id` (explicit `--deck` choice wins over path heuristics).
2. Else existing behavior: DB match on `root_path`, then `.harnessdeck/deck.toml` in `projectRoot`.

This lets a solo user apply `team-deck` to `~/other-app` while still using the deck’s active staging/prod environment.

### Apply semantics

- Deck layers are merged in deck order; positional layers after `--deck` append and override (same as multi-layer `project apply`).
- All existing flags pass through unchanged: `--dry-run`, `--harness`, `--strict-plugin-versions`, `--ignore-plugin-versions`, `--sync-plugins`, `--on-conflict`, `--format json`.
- Project status records the full expanded layer list (configured layer ids), same as today’s multi-layer apply.
- Mixing a single layer-export path/URL with `--deck` is an error (mirror “cannot mix export path with selectors”).

### `deck show` output (human)

```
Deck: team-platform
Root: /Users/me/team-deck
Active environment: staging

ORDER  NAME                    VERSION   DEFAULT ENV
1      engineering-foundation  1.0.0     —
2      backend-oncall          2.1.0     oncall-prod
3      team-overrides          0.1.0     —

Environments referenced: staging, prod, oncall-prod
```

JSON shape mirrors `exportDeckToDeckJson` plus ids and `root_path` for scripting.

### `deck delete` semantics

- `DELETE FROM decks WHERE id = ?`; `deck_layers` removed by FK.
- Does **not** call `deletePlugin` / `environment delete`.
- Non-interactive: delete without prompt (CI-safe).
- TTY without `--force`: confirm when `root_path` is set (“deck record only; directory … will not be removed”).
- Exit `1` if deck not found.

### `deck.toml` write-back (phase 2)

When `--write` is passed and `deck.root_path` is non-empty:

1. `exportDeckToDeckJson(deck.id)` → `formatDeckToml` → write `.harnessdeck/deck.toml`.
2. Fail clearly if `root_path` missing or not writable.
3. Without `--write`, DB is source of truth until next `deck export`.

Teams edit in DB + `--write` for git commit; solo users can skip `--write` until they export.

### `deck materialize` (phase 2)

1. Resolve repo root: argument path, or `deck.root_path` when passed deck name via `--deck` flag on materialize command.
2. `readDeckToml` + resolve plugins/resources (reuse doctor / exporter helpers).
3. `materializeDeckRepo` → write marketplace.json, plugin trees, deterministic JSON.
4. Suggest `deck doctor` in success hint.

### CLI help symmetry

**Apply lives on the noun being applied; `project` is for project-local ops.**

```
layer apply <layer...>     # alias: l apply
deck apply <deck> [layer...]

project scan | status | drift | mirror | history | revert
project apply              # compat alias → layer apply (deprecated)
```

Rationale: users choose **what** to apply (layer or deck) and pass `--project` for **where**. Snapshots and project registration remain side effects of apply — they are project-scoped outcomes, not a reason to hang apply under `project`.

Add `deck` to noun shorthand table only if a single letter is chosen (defer `d` — not in scope unless requested).

### Documentation

- `docs/cli/command-reference.md` — new `## deck` section.
- `SPEC.md` — deck subcommands table; `project apply --deck` in project section.
- `README.md` — quick start uses `hd l apply engineering-foundation`; deck example uses `hd deck apply my-deck`.
- `src/services/concepts-guide.ts` — layer: `layer apply`; deck: `deck apply`; project: scan/drift/mirror only.
- Onboarding hints (`init`, `guide`) updated from `project apply` to `layer apply`.

## Error handling

| Case | Message / exit |
| --- | --- |
| Deck not found | Exit `1`, hints: `deck list`, `deck import` |
| Deck has zero layers | Exit `1` on apply: “Deck has no layers; add with deck add-layer or deck import” |
| Layer in deck not resolvable | Same as `LayerResolveError` from `resolveApplyLayerSource` |
| `deck apply` + layer-export path as override | Exit `1`: override positionals must be layer selectors, not export paths |
| `project apply --deck` | Exit `1` with hint to use `deck apply` |
| `deck delete` not found | Exit `1` |

## Testing

### Phase 1

- `test/cli/deck.test.ts` — show, delete, list unchanged.
- `test/cli/apply-deck.test.ts` — `deck apply`; cascade with `deckId` when project path ≠ root_path.
- `test/cli/layer-apply.test.ts` — `layer apply` and `project apply` compat emit same result; compat prints deprecation in human mode.
- `test/services/resolve-deck-layers.test.ts` — selector ordering, published identity.

### Phase 2

- `test/cli/deck-curate.test.ts` — add/remove layer order; `--write` updates `deck.toml`.
- `test/cli/deck-materialize.test.ts` — golden file compare on marketplace.json (existing materializer tests extended).

## Success criteria

After phase 1:

```bash
hd deck import ./team-deck
hd deck show team-deck
hd l apply engineering-foundation --project ~/my-app --dry-run
hd deck apply team-deck --project ~/my-app
hd deck delete old-deck
```

After phase 2:

```bash
hd deck add-layer team-deck my-overrides --write
hd deck materialize ./team-deck
hd deck doctor ./team-deck
```

## Open questions (resolved)

| Question | Decision |
| --- | --- |
| Primary audience | **C** — both solo SQLite and git repo workflows |
| Apply entry points | **`layer apply` / `deck apply` canonical**; `project apply` compat alias for layers only |
| Stack overrides on deck apply | Yes — positional layers after deck expansion |
| Delete layers with deck | No |
| Phase 1 includes materialize | No — phase 2 for team persona |
