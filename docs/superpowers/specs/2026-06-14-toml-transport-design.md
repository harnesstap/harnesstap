# TOML transport design

**Date:** 2026-06-14  
**Status:** Approved  
**Related:** [SPEC.md](../../../SPEC.md), [harnessdeck-cloud layer export](../../../harnessdeck-cloud/content/docs/cloud/layers.mdx)

## Problem

HarnessDeck transport today splits metadata and content across JSON/JSONC files:

- `.harnessdeck/deck.json` plus `.harnessdeck/environments/*.json` for deck repos
- `*.harnessdeck.jsonc` for portable layer exports
- `embedded_plugins[].files` as escaped JSON strings for inlined plugin trees

Multiline content (skills, rules, hook scripts, Codex agent TOML) is painful to author, diff, and review in JSON. Portable “one file” bundles are awkward because the format fights human editing.

## Goals

1. **TOML-only transport** for `urn:harnessdeck:layer:v1`, `urn:harnessdeck:deck:v1`, and `urn:harnessdeck:bundle:v1`.
2. **In-repo deck metadata** in `.harnessdeck/deck.toml` with environments inlined (no separate `environments/*.json`).
3. **Portable single-file bundles** via `urn:harnessdeck:bundle:v1` (`<name>.harnessdeck.toml`).
4. **Cloud publish/download** stores and serves TOML layer exports only.
5. **One internal model** in the CLI — TypeScript types unchanged; TOML is the sole wire encoding for these schemas.

## Non-goals

- TOML for HarnessDeck toolkit config (`~/.harnessdeck/config.jsonc`, cloud profiles, SQLite) — JSON/JSONC remains fine there.
- Automatic import of legacy JSON/JSONC transport files (see breaking changes).
- Binary plugin assets in transport (still text-only; base64 if ever required).

## Breaking changes

This is a **clean break**. No dual encoders, no `--format json`, no sniff-and-fallback.

| Removed | Replaced by |
| --- | --- |
| `.harnessdeck/deck.json` | `.harnessdeck/deck.toml` |
| `.harnessdeck/environments/<name>.json` | `[environments.<name>]` in `deck.toml` |
| `*.harnessdeck.jsonc` | `*.harnessdeck.toml` (layer or bundle) |
| Cloud `Content-Type: application/json` layer exports | `Content-Type: application/toml` |
| `jsonc-parser` on transport paths | `smol-toml` |

Importing a JSON/JSONC deck or layer file **fails** with an actionable error pointing at TOML export.

## Schema family

Three URNs share one logical model. The `schema` key at the top of every transport file identifies which shape to parse.

```
urn:harnessdeck:layer:v1   — publish unit (layers, resources, plugins, embedded trees)
urn:harnessdeck:deck:v1    — git repo composition (selectors + environments)
urn:harnessdeck:bundle:v1  — portable superset (deck + full layers + shared embedded_plugins)
```

```
                    ┌─────────────────┐
                    │  bundle:v1      │
                    │  (portable)     │
                    └────────┬────────┘
                             │ embeds
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────────────┐
        │ deck:v1  │   │ layer:v1 │   │ embedded_plugins │
        │ metadata │   │ payloads │   │ (deduped root)   │
        └──────────┘   └──────────┘   └──────────────────┘
```

| Schema | Typical path | Primary use |
| --- | --- | --- |
| `deck:v1` | `.harnessdeck/deck.toml` | Git repo; layer selectors only |
| `layer:v1` | `.harnessdeck/layers/<name>@<version>.harnessdeck.toml` or standalone export | `layer publish`, cloud storage, single-layer portable file |
| `bundle:v1` | `<name>.harnessdeck.toml` | One-file portable share, `migrate export` |

**Dedup rule (bundle):** `embedded_plugins` live at bundle root. Layers reference them via `embedded_plugin_refs` (same semantics as today). File trees are never duplicated across layers in one bundle.

## TOML conventions

### Header (all schemas)

```toml
schema = "urn:harnessdeck:deck:v1"
version = 1
```

- `schema` — URN string (replaces JSON `$schema`).
- `version` — integer schema version (starts at `1`).

### Multiline content

Resource `content` and embedded plugin file bodies use TOML multiline basic strings (`"""…"""`). Literal `"""` inside content is escaped per TOML 1.0 rules.

### Embedded plugin files

Plugins are keyed by `ref` (quoted when path-like):

```toml
[embedded_plugins."./plugins/demo"]
ref = "./plugins/demo"
version_constraint = "*"
root = "demo"

[embedded_plugins."./plugins/demo".files]
"skills/fix-ci/SKILL.md" = """
---
name: fix-ci
---
# Fix CI
"""
".codex/agents/reviewer.toml" = """
name = "reviewer"
model = "gpt-5.4"
"""
```

Path keys use POSIX separators. Values are always inline multiline strings in the transport file.

### Resource metadata

- Known discriminated shapes (`type`-specific fields) serialize as inline TOML tables on the resource row.
- Rare or forward-compatible metadata uses `metadata_json` (a JSON string value inside TOML). Importers parse it only when inline tables are absent.

### Tables vs arrays

| Concept | TOML form |
| --- | --- |
| Ordered list (layers in deck, resources) | `[[layers]]`, `[[resources]]`, `[[plugins]]` |
| Map (environment values, secret refs) | `[environments.<name>.values]`, `[environments.<name>.secret_refs.<KEY>]` |
| Named plugin trees | `[embedded_plugins."<ref>"]` |

## `urn:harnessdeck:deck:v1`

Canonical repo file: **`.harnessdeck/deck.toml`**.

```toml
schema = "urn:harnessdeck:deck:v1"
version = 1

name = "backend-oncall"
active_environment = "oncall-prod"

[[layers]]
name = "backend-oncall"
version = "1.0.0"
org = "acme"
catalog = "platform"
environment = "oncall-prod"

[environments.oncall-prod.values]
PD_REGION = "us"
LOG_LEVEL = "warn"

[environments.staging.values]
PD_REGION = "eu"

[environments.oncall-prod.secret_refs.PAGERDUTY_TOKEN]
provider = "keychain"
ref = "harnessdeck/backend-oncall/oncall-prod/PAGERDUTY_TOKEN"
```

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Deck name |
| `active_environment` | no | Name of active environment |
| `[[layers]]` | yes (may be empty) | Selectors: `name`, `version`, optional `org`, `catalog`, `environment` |
| `[environments.<name>]` | no | Inlined environments; replaces per-file JSON |
| `environments.<name>.values` | no | Flat string map |
| `environments.<name>.secret_refs.<key>` | no | `provider`, `ref` |

Layer entries reference published or local layers by selector only — no inlined resources.

Optional sidecar layer files under `.harnessdeck/layers/` use `layer:v1` for portable deck-repo round-trip (`deck export --with-layer-exports`).

## `urn:harnessdeck:layer:v1`

Standalone layer export and cloud publish unit.

```toml
schema = "urn:harnessdeck:layer:v1"
version = 1

[[layers]]
name = "team-stack"
version = "1.0.0"
description = "Shared team harness"
tags = ["team", "backend"]

[[layers.dependencies]]
name = "base-platform"
version_constraint = "^1.0.0"

[[layers.resources]]
type = "skill"
name = "fix-ci"
namespace = "team-stack"
description = ""
content = """
---
name: fix-ci
---
# Fix CI
"""

[[layers.plugins]]
ref = "formatter@acme-marketplace"
version_constraint = "^2.1.0"

[layers.claude.marketplaces.team-plugins]
source = { source = "github", repo = "org/claude-plugins" }
autoUpdate = true

[[layers.claude.plugins]]
id = "formatter@team-plugins"
enabled = true
version = "1.2.0"
```

For a single-layer file, exactly one `[[layers]]` row is required. Multi-layer files use multiple `[[layers]]` rows and optional root-level `embedded_plugins` (same as bundle).

### Root-level `embedded_plugins` (layer file)

When plugins are embedded, trees are siblings of `[[layers]]`:

```toml
[embedded_plugins."fmt@acme-marketplace"]
ref = "fmt@acme-marketplace"
version_constraint = "2.1.0"
root = "fmt-acme-marketplace"

[embedded_plugins."fmt@acme-marketplace".files]
"skills/format/SKILL.md" = """..."""
```

Layers list `embedded_plugin_refs = ["fmt@acme-marketplace"]` when pinning inlined trees.

### Exported fields (unchanged semantics)

Omit from transport: database `id`, timestamps, `org_slug`, `catalog_slug`, `source` on resources. Publish adds org/catalog in cloud metadata, not in the layer body.

Default export path: `<name>.harnessdeck.toml`.

## `urn:harnessdeck:bundle:v1`

Single portable file combining deck metadata, environments, full layer payloads, and deduplicated embedded plugins.

```toml
schema = "urn:harnessdeck:bundle:v1"
version = 1

[deck]
name = "team-portable"
active_environment = "prod"

[[deck.layers]]
name = "team-stack"
version = "1.0.0"
environment = "prod"

[environments.prod.values]
PD_REGION = "us"

[[layers]]
name = "team-stack"
version = "1.0.0"
description = "..."
tags = ["team"]
# ... resources, plugins, claude, dependencies (full layer:v1 row)

[embedded_plugins."fmt@acme-marketplace"]
ref = "fmt@acme-marketplace"
version_constraint = "2.1.0"
root = "fmt-acme-marketplace"

[embedded_plugins."fmt@acme-marketplace".files]
"skills/format/SKILL.md" = """..."""
```

`[deck]` and `[[deck.layers]]` mirror `deck:v1` without environments duplicated — environments are top-level `[environments.*]` shared by the bundle. `[[layers]]` carries full layer bodies.

Default path: `<name>.harnessdeck.toml` (same extension as layer; disambiguate by `schema` on read).

## CLI architecture

### Transport module

New `src/services/transport/`:

| Module | Responsibility |
| --- | --- |
| `read.ts` | Read file, parse TOML, validate `schema` + `version`, return typed document |
| `write.ts` | Serialize typed document to stable TOML |
| `layer.ts` | `layer:v1` ↔ `LayerExport` |
| `deck.ts` | `deck:v1` ↔ `DeckJson` |
| `bundle.ts` | `bundle:v1` ↔ composite type |
| `validate.ts` | Schema-specific validation errors |

Use `smol-toml` (already a dependency). Remove `jsonc-parser` from transport code paths.

### Command behavior

| Command | Change |
| --- | --- |
| `layer export` | Writes `*.harnessdeck.toml` (`layer:v1`) |
| `layer import` | Reads TOML only |
| `deck materialize` / `deck doctor` | Reads/writes `.harnessdeck/deck.toml` |
| `deck export` | Writes `deck.toml`; `--with-layer-exports` writes `layer:v1` sidecars |
| `deck import` | Reads `deck.toml` + optional layer sidecars, or a `bundle:v1` file |
| `migrate export` / `import` | `bundle:v1` TOML (or tar.gz of TOML files) |
| `layer publish` | Uploads TOML body |
| `layer pull` | Downloads TOML, imports as `layer:v1` |

Extension detection: `.toml` / `.harnessdeck.toml` required; other extensions rejected.

### Repo layout

```
.harnessdeck/
  deck.toml
  layers/
    team-stack@1.0.0.harnessdeck.toml   # optional, from --with-layer-exports
```

No `deck.json`, no `environments/` directory.

## Cloud (harnessdeck-cloud)

### Storage

- Published version blob is **TOML text** (`layer:v1`).
- `layerExportSha256` hashes the UTF-8 TOML body (unchanged dedup semantics).
- Existing JSON blobs in storage are orphaned; no read path for them after deploy.

### HTTP

| Endpoint | Change |
| --- | --- |
| Publish (`PATCH /api/layers`, CLI publish) | Accept `Content-Type: application/toml` body or `harnessdeckLayerExportBody` TOML string |
| Download (`…/layer-export`) | `Content-Type: application/toml`; `Content-Disposition: attachment; filename="<slug>-<version>.harnessdeck.toml"` |
| Web UI import textarea | TOML placeholder and validation |

Control-plane JSON APIs (auth, orgs, metadata) stay JSON. Only layer export **bodies** are TOML.

### Publish pipeline

1. CLI sends TOML `layer:v1` body.
2. Cloud parses TOML → internal `PublishedLayerExportContent` (for pins/resources indexing).
3. Store raw TOML bytes.
4. On download, return stored TOML (re-serialize only if normalization is required).

Remove `formatLayerExportForDownload` JSON reconstruction paths.

## Error handling

| Situation | Behavior |
| --- | --- |
| Wrong file extension | Exit 1: expected `.toml` or `.harnessdeck.toml` |
| JSON/JSONC file presented | Exit 1: JSON transport removed; re-export with `hd layer export` |
| Unknown `schema` URN | Exit 1: list supported URNs |
| TOML parse error | Exit 1: line/column from parser |
| Schema validation failure | Exit 1: field path + constraint |

## Testing

1. Round-trip tests per schema: model → TOML → model (stable bytes or canonical compare).
2. Multiline content: skills, scripts, nested TOML agents — no corruption.
3. Embedded plugin trees: path keys with dots, slashes, quotes.
4. Bundle dedup: two layers sharing one `embedded_plugins` ref.
5. Cloud publish/download integration with TOML bodies.
6. `deck doctor` on repos with only `deck.toml`.
7. Explicit test that `.json` / `.jsonc` import fails with the documented message.

## Documentation updates

- [SPEC.md](../../../SPEC.md) transport section — rewrite for TOML-only.
- [README.md](../../../README.md) import/export examples.
- harnessdeck-cloud `content/docs/cloud/layers.mdx` and CLI docs.
- Scenario tapes referencing `*.jsonc` paths.

## Implementation order

1. **Transport module** — parse/serialize `layer:v1` TOML; port exporter tests.
2. **Layer CLI** — export/import/publish/pull on TOML.
3. **Deck v1** — `deck.toml`, materializer, doctor; drop JSON deck paths.
4. **Bundle v1** — portable export/import, migrate.
5. **Cloud** — publish/download TOML; remove JSON formatters.
6. **Docs + fixtures** — update all examples and test fixtures to TOML.

## Open items (none blocking)

- Stable TOML key ordering for deterministic `sha256` (specify sort order in `write.ts` tests).
- Maximum bundle size limits unchanged (plan-tier caps on cloud).
