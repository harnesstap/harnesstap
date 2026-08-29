---
description: Repositories where HarnessTap scans, applies, mirrors, and tracks harness configuration.
---

# Projects

A **project** is a repository (or directory tree) where HarnessTap materializes harness configuration. Project workflows center on scan, apply, mirror, drift detection, and snapshot revert — all scoped to the working tree rather than machine-wide home paths.

## Repo-scoped apply

`apply` is the canonical write path for project baselines:

```bash
ht apply my-setup --project . --harness claude-code,codex,cursor --dry-run
ht apply my-setup --project . --harness claude-code,codex,cursor
ht status .
```

Stack multiple plugins in one command (see [Scenario 25](../../scenarios/details/25-stack-plugins.md)). `apply` resolves bare catalog names at apply time, so public baselines work without a prior `plugin pull`:

```bash
ht apply engineering-foundation --project .
```

Plugin-version policy when the plugin carries plugin pins:

```bash
ht apply my-setup --strict-plugin-versions   # exit 2 on pin violation
ht apply my-setup --ignore-plugin-versions   # skip validation
ht apply my-setup --sync-plugins             # refresh plugin resources first
```

Applying a plugin writes a known baseline onto disk. It is distinct from **mirror**, which syncs alias harness outputs from the current on-disk main harness without re-specifying the plugin.

## Scan and track

Discover existing configuration before composing plugins:

```bash
ht scan .
ht resource list
ht plugin from-project inferred-stack --project .
```

When the target repository has a git `origin`, `apply` stores a **snapshot** of tracked generated files before writing. Snapshots power history, drift detection, and revert.

| Command | Git requirement |
| --- | --- |
| `history` | Git-backed project with `origin` |
| `status --check` | Git-backed project |
| `apply` (with snapshot) | Git `origin` on target project |
| `revert` | Snapshot ID from `history` |
| `harness project set` / `harness project status` | Git-backed project |

`apply` can write files outside git, but snapshot and history support only works when the target project has a git `origin`.

## Mirror

`mirror` propagates configuration from the **main** harness to **alias** harnesses in the same repository — useful after manual edits to the primary harness files:

```bash
ht mirror .
ht mirror . --force-shift-reference codex
ht mirror . --dry-run
```

Mirror compares and shifts references between harness-specific file layouts. It does not re-resolve plugin composition; use `apply` when you need a fresh baseline from the library.

See [Scenario 27](../../scenarios/details/27-project-sync.md) for the cross-harness mirror walkthrough and [Scenario 33](../../scenarios/details/33-mirror-plugin-fallback.md) for plugin fallback behavior.

## Drift and revert

After apply, teammates may edit generated files directly. HarnessTap tracks drift against the last apply or mirror snapshot:

```bash
ht status . --check
ht status . --check --format json   # exit 1 when drift exists
ht history .
ht revert <snapshot-id>
```

`status --check` compares the current working tree against the latest apply/mirror snapshot. Exit code `1` means actionable drift was found — useful in CI guardrails.

See [Scenario 21](../../scenarios/details/21-detect-drift.md).

## Project harness preferences

Per-project harness settings (main and aliases for this repo) are separate from global `harness set`:

```bash
ht harness project status .
ht harness project set --main claude-code --aliases cursor
```

These require a git-backed project and influence which harnesses `apply` and `mirror` target by default.

## Snapshots in practice

Typical lifecycle:

1. `ht apply team-baseline --project .` — writes files, stores snapshot (when git `origin` exists)
2. Developer edits `.cursor/rules/foo.mdc` by hand
3. `ht status . --check` — reports divergence from snapshot
4. Either re-apply the plugin, mirror from main, or `ht revert <id>` to restore

Preview before writing:

```bash
ht apply team-baseline --project . --dry-run
```

See [Scenario 7](../../scenarios/details/07-preview-apply-plugin.md).

## Profiles vs projects

| | Profiles | Projects |
| --- | --- | --- |
| **Scope** | Machine home harness paths | Repository working tree |
| **Primary command** | `profile use` | `apply` |
| **Typical use** | Work/personal machine presets | Team repo baselines |
| **Drift / revert** | Not tracked | `status --check` / `revert` |

Use [Profiles](./profiles.md) for machine-wide defaults and projects for repository-specific configuration.

## Project profile config

Repositories can declare named **profiles**, environments, and plugin composition in `apm.yml` at the repo root. Standard OpenAPM keys (`name`, `version`, `targets`, `dependencies`) still parse. Extra top-level keys are preserved. HarnessTap-only fields are first-class top-level keys (`default_profile`, `environments`, `profiles`, `plugins`); vanilla APM readers ignore them. `environments.default` names the active environment; other `environments` keys are named how-value bundles (secret **refs** only).

Example:

```yaml
name: demo
version: "1.0.0"
targets: [cursor, claude]
dependencies:
  apm:
    - team-stack
  mcp:
    - io.github.github/github-mcp-server
    - name: filesystem
      registry: false
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
default_profile: dev
environments:
  default: shared
  shared:
    values:
      REGION: us
    secret_refs:
      API_KEY:
        provider: env
        ref: API_KEY
profiles:
  - name: dev
    source: local
    selector: team-stack
  - name: prod
    source: catalog
    selector: acme/platform/frontend@1.0.0
  - name: custom
    source: inline
    plugin: embedded-plugin
plugins:
  - name: embedded-plugin
    description: Small inline plugin bundled with the repo
```

Inspect and validate the resolved config:

```bash
ht config show
ht config show --format json
ht config validate --project .
ht config validate --format json   # exit 1 when invalid
```

Create a starter config from local profile plugins:

```bash
ht config init
ht config init --profile work --profile personal --default work
ht config init --force   # overwrite an existing file
```

`config init` maps each selected profile plugin to a local `source: local` entry and sets `default_profile`. Opening a project in HarnessTap Desktop instead seeds a `project default` profile from that repository’s on-disk resources. It does not add `global default` to the project.

Switch to a configured profile with `ht use`:

```bash
ht use                        # interactive picker when multiple profiles exist
ht use --profile dev          # apply the dev profile directly
ht use --list                 # list profiles without applying
```

Project profiles reuse the same plugin sources as machine-wide [Profiles](./profiles.md), but apply through `ht use` in the repository instead of `profile use` at home paths.

## Related

- [Plugins](./plugins.md) — what you apply
- [Resources](./resources.md) — what scan imports
- [Profiles](./profiles.md) — machine-wide apply
- [Portability limits](../../portability-limits.md) — cross-harness mirror caveats
- [Apply git dependencies](../use/apply-git-deps.md) — `ht apply` pull of `dependencies.apm` git entries
- [Command reference](../command-reference.md) — `scan`, `mirror`, `status`, `history`, `revert`, and `apply`
- [Scenario 7](../../scenarios/details/07-preview-apply-plugin.md) — preview and apply
- [Scenario 21](../../scenarios/details/21-detect-drift.md) — detect drift
- [Scenario 27](../../scenarios/details/27-project-sync.md) — mirror
