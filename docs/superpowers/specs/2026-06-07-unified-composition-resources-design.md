# Unified Composition Resources Design

**Status:** Approved (2026-06-07).

**Supersedes:**

- [2026-05-19-claude-plugin-inventory-design.md](./2026-05-19-claude-plugin-inventory-design.md) — dedicated plugin pins, `project_plugin_state`, `hd plugin list|show`
- [2026-05-19-plugin-lifecycle-design.md](./2026-05-19-plugin-lifecycle-design.md) — `hd plugin check|update|refresh|installed`

**Related:**

- [2026-05-26-storage-and-identity-design.md](./2026-05-26-storage-and-identity-design.md) — resource identity, namespaces, `origin_kind`
- [SPEC.md](../../../SPEC.md) — deck model, environments, configured layers

## Problem

HarnessDeck currently uses **three parallel attachment mechanisms** on a design layer (design plugin):

1. Canonical resources (`skill`, `hook`, …) via `plugin_resources`
2. Native plugin pins via `plugin_native_pins` and `layer attach --type plugin`
3. Layer dependencies via `plugin_dependencies` and `layer attach --type layer-dependency`

A separate **`hd plugin`** command group wraps harness-native install/check/update tooling and maintains `project_plugin_state` for committed vs effective inventory.

This splits the mental model users already understand from resources: compose by attaching references, refresh by syncing, apply to projects. Plugin freshness and layer composition should follow the same path.

## Goals

1. **One composition model:** a design layer is an ordered list of resource attachments plus an optional environment binding.
2. **`plugin` as a resource type:** marketplace and local plugin references are rows in `resources`, attached like any other type.
3. **`layer` as a composition resource:** layer-on-layer references are resource rows used only for composition; hidden from default `hd resource list`.
4. **`hd resource sync` owns freshness:** marketplace/local plugin trees are fetched or re-scanned here; no `hd plugin` commands.
5. **Lazy plugin attach:** `layer attach plugin:…` links only; sync is explicit (or triggered by apply/doctor when needed).
6. **Interactive sync conflicts:** when upstream plugin content changes, offer overwrite, ignore, copy-to-namespace, or cancel per resource.
7. **Harness-agnostic plugin metadata:** resource identity is not tied to a harness; per-harness materialization happens at apply time.
8. **Latest by default:** absent `version_constraint` means floating latest; optional semver constraint on the plugin resource.

## Non-Goals

- Hosting a plugin marketplace or registry inside HarnessDeck.
- Wrapping `claude plugin install|uninstall|tag` as first-class CLI commands.
- Token-cost estimates or full parity with `claude plugin details`.
- Eager marketplace fetch on `layer attach plugin:…` (attach is lazy by design).
- Listing composition `layer` refs in `hd resource list` (they remain discoverable via `hd layer list` and `hd resource show`).

## Design Summary

```
design layer  =  ordered resource attachments  +  optional environment

resource types (material)     skill | hook | rule | mcp_server | hook | agent | command | …
resource types (composition)  plugin | layer
```

| Type | In `hd resource list` | Attach example | Refresh |
| --- | --- | --- | --- |
| Material (`skill`, …) | yes | `layer attach L skill:foo@ns` | N/A (or `resource sync` when `origin_kind=marketplace_link`) |
| `plugin` | yes | `layer attach L plugin:posthog@cursor-team-kit` | `resource sync plugin:posthog@cursor-team-kit` |
| `layer` | **no** | `layer attach L layer:backend-oncall@^1.0` | N/A (resolves to library layer version) |

Remove entirely:

- CLI group `hd plugin` (`list`, `show`, `installed`, `check`, `update`, `refresh`)
- Tables `plugin_native_pins`, `plugin_dependencies`, `project_plugin_state`
- `layer attach --type plugin` / `--type layer-dependency` (type comes from selector prefix)
- `~/.harnessdeck/plugin-refresh-cache.json` as a separate lifecycle cache (sync may use its own metadata timestamps on resources)

Keep repurposed:

- `plugin-source-import.ts` — invoked by `resource sync`
- Marketplace install-path resolution (today in `resource-sync.ts`)
- Per-harness serialization on `project apply` (enabled plugins, generated marketplace files)

## Resource Types

### `plugin`

A **reference** to a marketplace or local plugin tree, not a duplicate of all child files.

**Identity:** `(type=plugin, name, namespace)` per existing selector grammar.

| Case | `name` | `namespace` | `origin_ref` |
| --- | --- | --- | --- |
| Marketplace | `posthog` | `cursor-team-kit` | `posthog@cursor-team-kit` |
| Local / in-repo | `my-formatter` | `""` | `./plugins/my-formatter` (normalized) |

**Metadata (superset, harness-agnostic):**

```ts
interface PluginResourceMetadata {
  source_kind: "marketplace" | "local" | "git";
  marketplace_name?: string;
  version_constraint?: string;   // absent = floating "latest"
  resolved_version?: string;     // set by last successful sync
  sync_status?: "synced" | "stale" | "pinned" | "never_synced";
  portable?: "reference" | "embed";  // export behavior (replaces embed_on_export on pins)
  manifests?: {
    claude?: Record<string, unknown>;
    cursor?: Record<string, unknown>;
  };
}
```

**Content:** empty or minimal JSON snapshot of plugin manifest(s) from last sync.

**Child resources:** skills, hooks, rules, etc. imported under `namespace = plugin name` (or existing marketplace_link convention) with `origin_kind = marketplace_link` and `origin_ref` pointing at the plugin resource.

Plugin resources are **not** bound to a harness type. Serializers read the superset metadata and emit Claude, Cursor, Codex, or other harness outputs on apply. `layer doctor` / `project apply` warn when a declared plugin cannot be materialized for the project's main harness.

### `layer`

A **composition reference** to another design layer in the local library.

**Identity:** `(type=layer, name, namespace="")` — layers are library-local, not marketplace namespaced.

**Metadata:**

```ts
interface LayerResourceMetadata {
  version_constraint?: string;  // absent = latest library version
  resolved_version?: string;    // last resolved target version
  resolved_layer_id?: string;   // ULID of resolved design layer row
}
```

**Visibility:** excluded from default `hd resource list` and `hd resource list --type layer`. Included in `hd resource show layer:backend-oncall` for debugging.

**Expansion:** on `project apply`, resolve layer refs depth-first with **cycle detection**, merge resources in attachment order (later overrides earlier), same as multi-layer apply today.

## Composition UX

### Attach (lazy for plugins)

```bash
hd layer attach backend-oncall plugin:posthog@cursor-team-kit
hd layer attach platform layer:backend-oncall@^1.0
hd layer attach backend-oncall skill:api-guide
```

**Plugin attach behavior:**

1. If no `plugin` resource exists for the selector, create a stub row (`sync_status: never_synced`, no `resolved_version`).
2. Insert `plugin_resources` link (idempotent).
3. **Do not** fetch marketplace or import children (lazy).

**Optional version constraint** at attach time sets `metadata.version_constraint` on the plugin resource (or layer resource). Re-attaching the same selector is idempotent; it does not trigger sync.

**Explicit sync:**

```bash
hd resource sync plugin:posthog@cursor-team-kit
hd resource sync                    # all plugin resources + linked children
```

**Eager opt-in:** `hd layer attach … --sync` runs sync immediately after link (non-default).

### Layer show (grouped tree)

```
platform-standards
  layer: backend-oncall@^1.0  →  v1.2.0
    plugin: posthog@cursor-team-kit  (latest, never synced)
      skill: incident-runbook@posthog
  skill: org-wide-style
```

## `resource sync`

### Plugin root sync

For `type=plugin`:

1. Resolve marketplace or local path (offline: fail with clear message if never synced and no cache).
2. Fetch/install or re-scan tree via `plugin-source-import`.
3. Update plugin resource metadata (`resolved_version`, `manifests`, `sync_status`).
4. Diff child resources in the plugin namespace against the import result.
5. For each changed child with local divergence → **conflict flow** (below).
6. Upsert new/changed children; remove orphans only with `--prune` (non-default).

### Child / linked resource sync

Existing behavior for `origin_kind=marketplace_link` material resources remains; plugin sync is the **root** operation that refreshes the whole subtree.

### Version constraints

- **No `version_constraint`:** resolve latest available on sync.
- **Exact or range:** resolve latest **satisfying** constraint; fail sync if none match.
- **`resolved_version`:** lockfile from last successful sync; export/deck doctor compares against this.

### Conflict resolution

When upstream content for a child resource differs from the stored row and the user (or policy) has not marked it pinned:

| Choice | Behavior |
| --- | --- |
| **Overwrite** | Replace stored content; clear `sync_status: pinned` if any |
| **Ignore** | Keep local content; set `metadata.sync_status: pinned` on that resource so future syncs skip it unless `--force` |
| **Copy** | Fork to a new namespace (including `""` for local unnamespaced); user then chooses overwrite or ignore on the original |
| **Cancel** | Skip this resource and continue sync; summary lists skipped items |

**TTY:** interactive prompt per conflict (same wizard gates as `project scan`).

**Non-interactive:**

```bash
hd resource sync --on-conflict overwrite|ignore|fail
```

Default: `fail` in CI / `--no-interactive`; prompt on TTY.

**Cancel all:** user can abort the entire sync operation; already-applied updates in the current run are reported in the summary (partial sync is explicit).

## Replacing `hd plugin`

| Former command | Replacement |
| --- | --- |
| `hd plugin list` | `hd project status` — plugins declared by applied layers + harness settings discovered on scan |
| `hd plugin show` | `hd resource show plugin:…` |
| `hd plugin check` | `hd resource sync` (library) + `hd layer doctor` / `hd project drift` (declared vs materialized) |
| `hd plugin update` | `hd resource sync plugin:…` then `hd project apply` |
| `hd plugin refresh` | part of `resource sync` |
| `hd plugin installed` | removed; install state is a project filesystem concern surfaced via scan/status |

### Project scan

`project scan` continues to import harness configuration and may offer:

> Found `posthog@cursor-team-kit` in project settings — import as `plugin` resource?

Scan does **not** maintain `project_plugin_state`. Optional: store last-scan plugin summary on the project row for status display only (derived, not a parallel catalog).

### Apply

`project apply`:

1. Expand `layer` composition resources (with cycle detection).
2. Merge material + `plugin` resources in order.
3. For each `plugin` resource: if `never_synced` or `stale`, **warn** (do not auto-sync by default) or sync when `--sync-plugins` is passed.
4. Serialize per harness: file materialization for material types; plugin declarations for harness plugin settings and generated marketplace files.

**Strictness flags** (evolve from old apply plugin flags):

- `--strict-plugin-versions` — fail if `resolved_version` does not satisfy `version_constraint` or is missing when constraint is set
- `--sync-plugins` — run plugin sync for attached plugin resources before materialize
- `--ignore-plugin-versions` — skip version constraint checks

### Deck / bundle transport

- Export writes `plugin` resources in the flat `resources[]` list; derived `plugins[]` in bundle v1 may remain for backward import during transition.
- Portable decks snapshot `resolved_version` at export time.
- `metadata.portable: embed` inlines plugin trees in export (replaces `--embed-plugins` on pins).
- Generated `.claude-plugin/marketplace.json` and native files remain for consumers without HarnessDeck.

## Storage Migration

### New / changed

- Add `plugin` and `layer` to `RESOURCE_TYPES` (composition types filtered in list queries).
- `plugin_resources` holds all attachments including `plugin` and `layer` resource IDs.

### Migrate away

| Old | New |
| --- | --- |
| `plugin_native_pins` row | `plugin` resource + `plugin_resources` link |
| `plugin_dependencies` row | `layer` resource + `plugin_resources` link |
| `project_plugin_state` | drop; use scan/status + library resources |

Migration script:

1. For each `plugin_native_pins` row, upsert `plugin` resource keyed by parsed ref, copy `version_constraint` and `embed_on_export` → `metadata.portable`.
2. For each `plugin_dependencies` row, upsert `layer` resource, copy `version_constraint`.
3. Attach to parent design layer via `plugin_resources`.
4. Drop old tables after one release with read-compat shim if needed.

## CLI Changes

### Removed

```
hd plugin list | show | installed | check | update | refresh
layer attach --type plugin | layer-dependency
layer attach --version (moves to resource metadata via attach or resource pin)
```

### Added / changed

```
layer attach <layer> <selector>           # selector includes type: prefix
layer attach <layer> plugin:… [--sync]    # --sync is opt-in eager
layer attach <layer> layer:… [--version …]

resource sync [selector] [--on-conflict …] [--prune] [--force]
resource pin <selector> [--version <constraint>]   # optional convenience
resource list                             # excludes type=layer; includes type=plugin
resource show layer:…                     # works for composition refs
```

### `layer add` wizard

Single flow: pick selector (resource, plugin, or layer ref). Remove three-way "Resource / Plugin / Dependency" fork.

## Resolved Decisions

1. **Lazy plugin attach** — `layer attach plugin:…` links only; sync is explicit, via `--sync` on attach, `resource sync`, or optional `--sync-plugins` on apply.
2. **Project scan** — still discovers harness plugin settings; offers import as `plugin` resource; no `hd plugin list`.
3. **Deck / non-HarnessDeck consumers** — apply generates marketplace/native files; export snapshots `resolved_version`.
4. **Visibility** — `plugin` resources appear in `hd resource list`; `layer` composition refs do not.

## Testing

- Attach plugin lazily: no network, stub `never_synced` row created.
- `resource sync` updates plugin + children; conflict prompts and `--on-conflict` policies.
- Layer expansion: ordering, overrides, cycle detection.
- Migration from `plugin_native_pins` and `plugin_dependencies`.
- Apply warns on `never_synced` plugin; `--sync-plugins` refreshes before materialize.
- Export/import round-trip for `plugin` and `layer` resources in bundle and deck formats.
- Removal of `hd plugin` CLI: commands return unknown or documented removal message for one release if needed.

## Documentation Updates

- `SPEC.md` — naming table, resource types, remove `hd plugin` section, update `layer attach` and `resource sync`
- `docs/cli/command-reference.md` — same
- Superseded specs — add status banner pointing here
- Scenario docs `08-audit-plugins`, `12-scripts-agents`, `19-refresh-plugin-metadata` — rewrite around `resource sync` and `project drift`
