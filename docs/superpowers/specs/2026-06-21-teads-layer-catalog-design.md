# Teads Layer Catalog Design

**Date:** 2026-06-21  
**Status:** Approved  
**Scope:** HarnessDeck layer catalog for Teads engineering — composable layers sourced from the `outbrain/claude-plugins` marketplace, published to HarnessDeck Cloud under a `teads` org, with role- and business-line-oriented convenience presets.

## Problem

Teads maintains an internal Claude Code plugin marketplace (`teads-plugins`, GitHub: `outbrain/claude-plugins`) with ~20 plugins spanning org access, data analytics, team tooling, and build/deploy. Today engineers install plugins ad hoc via `/plugin install` with no curated stack per role or business line.

Business lines (Enterprise ex-Teads vs Direct Response — Outbrain, Engage, DRC) and engineering roles (backend, data, frontend, platform) need different plugin combinations. Some concerns are org-wide (engineering standards, security, org access); others are team-specific (`engage-core`, `drc-tools`, `devx`, `supply-engines`). Observability tooling exists but is scattered across plugins with no shared layer.

HarnessDeck layers provide versioned, composable context packages with nested layer refs, plugin pins, and cloud catalog distribution — a natural fit for curating Teads plugin stacks.

## Goals

1. **Composable layer stack:** foundation → role → business line → optional team overlay.
2. **Convenience presets** so engineers can apply one layer (e.g. `teads-dr-backend`) instead of manual stacking.
3. **HarnessDeck Cloud distribution** via a `teads` org catalog — `hd layer apply teads-dr-backend` after `hd auth login`.
4. **Transparent marketplace bootstrap** — no manual `claude plugin marketplace add` for engineers; foundation layer carries `teads-plugins` metadata.
5. **Org-wide standards** extracted from `engage-core` into a new `teads-standards` plugin pinned by foundation.
6. **Team plugins as opt-in overlays** — separate `team-*` layers, not baked into BL presets.

## Non-goals (v1)

- Observability plugin consolidation (`teads-observability`) — deferred to v1.1.
- `plugin-dev` in any layer — plugin authors install it directly.
- Multi-harness apply (Cursor, Codex) — Claude Code is the primary target; layers use `claude.marketplaces` and `claude.plugins`.
- Org-wide secret vault integration — engineers bind secrets locally via HarnessDeck environments.
- Restructuring the `claude-plugins` repo layout beyond adding `layers/` definitions and `teads-standards`.

## Approach

**Nested layers + convenience presets (Approach 2).** Atomic layers use `layer:` refs; presets nest them without duplicating plugin pins. Team overlays are standalone single-plugin layers applied on top.

Rejected alternatives:

- **Atomic-only manual stacking** — poor discoverability; engineers won't know the right combination.
- **Flattened presets with duplicated pins** — drift when foundation changes; hard to maintain 8 presets × N plugins.

## Layer architecture

### Topology

```
teads-foundation
  → teads-role-{backend|data|frontend|platform}
    → teads-bl-{enterprise|dr}
      → (optional) team-{engage-core|drc-tools|devx|supply-engines}
```

Convenience presets nest the first three levels:

```
teads-enterprise-{backend|data|frontend|platform} = foundation + role + bl-enterprise
teads-dr-{backend|data|frontend|platform}         = foundation + role + bl-dr
```

### Layer inventory (v1)

| Layer | Type | Plugin pins / refs |
| --- | --- | --- |
| `teads-foundation` | atom | `enterprise`, `kubectl-safety-guard`, `atlassian-cli`, `teads-standards` |
| `teads-role-backend` | atom | `devx`, `jdtls` |
| `teads-role-data` | atom | `uv-script-generator` |
| `teads-role-frontend` | atom | `vtsls` |
| `teads-role-platform` | atom | `gitops-ci`, `devx` |
| `teads-bl-enterprise` | atom | `bq-teads-enterprise` |
| `teads-bl-dr` | atom | `bq-teads-dr` |
| `teads-enterprise-*` | preset | `layer:teads-foundation` + `layer:teads-role-*` + `layer:teads-bl-enterprise` |
| `teads-dr-*` | preset | `layer:teads-foundation` + `layer:teads-role-*` + `layer:teads-bl-dr` |
| `team-engage-core` | overlay | `engage-core` |
| `team-drc-tools` | overlay | `drc-tools` |
| `team-devx` | overlay | `devx` (only when role layer does not already include it — e.g. data engineer needing DevX tools) |
| `team-supply-engines` | overlay | `supply-engines` |

All plugin refs use the `@teads-plugins` marketplace namespace (matches `marketplace.json` `name` field). Duplicate plugin pins across stacked layers dedupe by ref at apply time.

**~19 layers** published to `teads/default`. Tags: `foundation`, `role`, `business-line`, `preset`, `team`, plus role/BL tags.

### Marketplace bootstrap (transparent apply)

`teads-foundation` embeds the marketplace in its `claude` block:

```toml
[claude.marketplaces.teads-plugins]
source = { source = "github", repo = "outbrain/claude-plugins" }
```

On `hd layer apply`, HarnessDeck must:

1. Merge `claude.marketplaces` from the resolved layer stack.
2. Run `claude plugin marketplace add <repo>` for any marketplace not yet on disk **before** plugin install.
3. Install pinned plugins, sync resources, write settings (`extraKnownMarketplaces`, `enabledPlugins`), materialize harness files.

**HarnessDeck enhancement required:** Today plugin install bootstraps marketplaces only from a hardcoded catalog hints table; layer `claude.marketplaces` is written to settings *after* install. Apply order must bootstrap from merged layer config first.

Engineers never run `/plugin marketplace add` manually.

### Preset matrix

| | Enterprise | Direct Response |
| --- | --- | --- |
| **Backend** | `teads-enterprise-backend` | `teads-dr-backend` |
| **Data** | `teads-enterprise-data` | `teads-dr-data` |
| **Frontend** | `teads-enterprise-frontend` | `teads-dr-frontend` |
| **Platform** | `teads-enterprise-platform` | `teads-dr-platform` |

Example onboarding:

```bash
hd auth login
hd layer apply teads-dr-backend team-engage-core --project .
```

## HarnessDeck Cloud distribution

### Org setup (one-time, DevX)

| Step | Action |
| --- | --- |
| 1 | Create `teads` org on HarnessDeck Cloud (slug: `teads`, email domains: `teads.com`, `outbrain.com`) |
| 2 | Add initial owners (DevX / platform team) |
| 3 | Default catalog `teads/default` auto-provisioned on org creation |

Visibility: **organization** — layers visible to Teads members after `hd auth login` with a linked `@teads.com` / `@outbrain.com` account.

### Publisher workflow (DevX)

```bash
hd auth login teads
hd layer catalog register teads/default

# Build layers locally, import from claude-plugins/layers/ TOML bundles
hd migrate import ./layers/teads-foundation.harnessdeck.toml
# ... compose nested refs via layer edit ...

hd layer publish teads-foundation
hd layer publish teads-dr-backend
```

Layer source definitions live in **`claude-plugins`** under `layers/` (TOML bundles or a manifest + build script). DevX publishes after `hd migrate import`.

### Versioning policy

| Concern | Policy |
| --- | --- |
| Layer versions | Semver per layer; patch for plugin pin bumps, minor for new plugins, major for breaking composition |
| Plugin pins | `^0.x` on marketplace plugins; `--strict-plugin-versions` in publisher CI |
| Preset inheritance | Presets use nested `layer:` refs only; bumping `teads-foundation` propagates on next preset publish |

## Environments and secrets

Layers carry **what**; environments carry **how**. Plugins needing runtime values declare `needs[]`; engineers bind secrets in named environments.

### Environment templates

| Environment | Purpose | Secrets |
| --- | --- | --- |
| `teads-default` | Baseline | None (optional model config) |
| `teads-enterprise-data` | BQ Enterprise | GCP via local `gcloud` auth; optional billing project env var |
| `teads-dr-data` | BQ DR | Same pattern, DR project refs |
| `teads-atlassian` | Jira/Confluence CLI | `ATLASSIAN_API_TOKEN`, `ATLASSIAN_EMAIL` |

Example binding:

```bash
hd environment create teads-atlassian --bind
hd environment edit teads-atlassian --secret ATLASSIAN_API_TOKEN:keychain:harnessdeck/atlassian
hd environment use teads-atlassian
hd layer apply teads-dr-backend team-engage-core --reapply
```

### Cascade

```
home environment ◂ layer default environment ◂ deck active environment
```

- `teads-foundation` → default env `teads-default`
- `teads-bl-enterprise` → default env `teads-enterprise-data`
- BL data layers may set domain env vars (`BQ_BILLING_PROJECT`, etc.)

### MCP auth limits

Atlassian MCP (used by `engage-docs`) requires OAuth connection in Claude Code — HarnessDeck environments cannot inject MCP OAuth. Document: team overlay `engage-docs` needs manual Atlassian MCP setup in Claude settings. Environment handles CLI-based Atlassian only.

### Out of scope v1

- Per-engineer AWS SSO injection (handled by `enterprise` plugin + `aws sso login`)
- Org-wide secret vault / Teads-specific secret provider

## teads-standards plugin and engage-core deduplication

### New plugin: `innovation-general/code-and-code-review/teads-standards`

Extract org-wide rules from `engage-core`:

| Rule file | Source | Notes |
| --- | --- | --- |
| `git.md` | `engage-core/rules/git.md` | Move as-is |
| `security.md` | `engage-core/rules/security.md` | Move as-is |
| `engineering-standards.md` | `engage-core/rules/team-standards.md` | Rename on move |

Pinned by `teads-foundation` as `teads-standards@teads-plugins`. Register in `marketplace.json`.

### Slim down engage-core

**Keep (team-specific):**

- `java-kotlin.md`, `frontend.md`, `api-design.md`, `testing.md`
- Hooks (`hooks.json`) — lint reminders, build verification
- Skills (`local-dev-springboot`, `deploy-check`, `test-gen`, `align`)
- `/align` command and per-repo templates

**Remove (now in teads-standards):** `git.md`, `security.md`, `team-standards.md`

### Stacking example

```
teads-dr-backend  →  teads-standards rules (via foundation)
team-engage-core  →  java-kotlin, frontend, hooks, skills (no duplicate git/security)
```

## v1.1: observability (deferred)

New `teads-observability` plugin consolidating:

- `go-pprof-dyploma` (Dyploma pprof)
- Grafana dashboard patterns (from `supply-engines`)
- Metrics/logging guidance (from `devx`/Metoda references)

Pinned by `teads-role-platform` and optionally `teads-role-backend` — not foundation.

## Implementation phases

| Phase | Work | Repo |
| --- | --- | --- |
| **0** | Create `teads` org on HarnessDeck Cloud | harnessdeck-cloud |
| **1** | HarnessDeck: bootstrap `claude.marketplaces` before plugin install on apply | harnessdeck |
| **2** | Create `teads-standards` plugin; slim `engage-core` | claude-plugins |
| **3** | Author layer TOML bundles in `claude-plugins/layers/` | claude-plugins |
| **4** | Import, validate (`layer doctor`), publish all layers to `teads/default` | harnessdeck CLI |
| **5** | Document engineer onboarding in `claude-plugins` README | claude-plugins |

## Testing

| Area | Validation |
| --- | --- |
| Marketplace bootstrap | Apply foundation on clean machine without pre-registered marketplace; plugins install successfully |
| Nested presets | `layer doctor` on each preset; no duplicate resources |
| engage-core dedup | Stack `teads-dr-backend` + `team-engage-core`; no conflicting git/security rules |
| Cloud pull | `hd layer pull teads/teads-dr-backend` after auth; apply to test project |
| Environment cascade | Layer with `needs[]` + bound environment resolves MCP/CLI placeholders |

## Open questions (resolved)

| Question | Decision |
| --- | --- |
| Organizing dimension | Roles primary; BL presets combine foundation + role + BL |
| Delivery | HarnessDeck Cloud `teads/default` (create org first) |
| Foundation contents | Cross-cutting tooling + standards; no plugin-dev; observability v1.1 |
| Team plugins | Separate overlay layers (Option B) |
| Marketplace registration | Transparent on apply via foundation `claude.marketplaces` + HarnessDeck bootstrap fix |
