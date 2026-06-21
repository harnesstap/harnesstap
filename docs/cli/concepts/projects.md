---
description: Repositories where HarnessDeck scans, applies, mirrors, and tracks harness configuration.
---

# Projects

A **project** is a repository (or directory tree) where HarnessDeck materializes harness configuration. Project workflows center on scan, apply, mirror, drift detection, and snapshot revert — all scoped to the working tree rather than machine-wide home paths.

## Repo-scoped apply

`layer apply` is the canonical write path for project baselines:

```bash
hd layer apply my-setup --project . --harness claude-code,codex,cursor --dry-run
hd layer apply my-setup --project . --harness claude-code,codex,cursor
hd project status .
```

Stack multiple layers in one command (see [Scenario 25](../../scenarios/details/25-stack-layers.md)). `layer apply` resolves bare catalog names at apply time, so public baselines work without a prior `layer pull`:

```bash
hd layer apply engineering-foundation --project .
```

Plugin-version policy when the layer carries plugin pins:

```bash
hd layer apply my-setup --strict-plugin-versions   # exit 2 on pin violation
hd layer apply my-setup --ignore-plugin-versions   # skip validation
hd layer apply my-setup --sync-plugins             # refresh plugin resources first
```

Applying a layer writes a known baseline onto disk. It is distinct from **mirror**, which syncs alias harness outputs from the current on-disk main harness without re-specifying the layer.

## Scan and track

Discover existing configuration before composing layers:

```bash
hd project scan .
hd resource list
hd layer from-project inferred-stack --project .
```

When the target repository has a git `origin`, `layer apply` stores a **snapshot** of tracked generated files before writing. Snapshots power history, drift detection, and revert.

| Command | Git requirement |
| --- | --- |
| `project history` | Git-backed project with `origin` |
| `project drift` | Git-backed project |
| `layer apply` (with snapshot) | Git `origin` on target project |
| `project revert` | Snapshot ID from `project history` |
| `harness project set` / `harness project status` | Git-backed project |

`layer apply` can write files outside git, but snapshot and history support only works when the target project has a git `origin`.

## Mirror

`project mirror` propagates configuration from the **main** harness to **alias** harnesses in the same repository — useful after manual edits to the primary harness files:

```bash
hd project mirror .
hd project mirror . --force-shift-reference codex
hd project mirror . --dry-run
```

Mirror compares and shifts references between harness-specific file layouts. It does not re-resolve layer composition; use `layer apply` when you need a fresh baseline from the library.

See [Scenario 27](../../scenarios/details/27-project-sync.md) for the cross-harness mirror walkthrough and [Scenario 33](../../scenarios/details/33-mirror-plugin-fallback.md) for plugin fallback behavior.

## Drift and revert

After apply, teammates may edit generated files directly. HarnessDeck tracks drift against the last apply or mirror snapshot:

```bash
hd project drift --project .
hd project drift --project . --format json   # exit 1 when drift exists
hd project history --project .
hd project revert <snapshot-id> --project .
```

`project drift` compares the current working tree against the latest apply/mirror snapshot. Exit code `1` means actionable drift was found — useful in CI guardrails.

See [Scenario 21](../../scenarios/details/21-detect-drift.md).

## Project harness preferences

Per-project harness settings (main and aliases for this repo) are separate from global `harness set`:

```bash
hd harness project status .
hd harness project set --main claude-code --aliases cursor
```

These require a git-backed project and influence which harnesses `layer apply` and `project mirror` target by default.

## Snapshots in practice

Typical lifecycle:

1. `hd layer apply team-baseline --project .` — writes files, stores snapshot (when git `origin` exists)
2. Developer edits `.cursor/rules/foo.mdc` by hand
3. `hd project drift .` — reports divergence from snapshot
4. Either re-apply the layer, mirror from main, or `hd project revert <id>` to restore

Preview before writing:

```bash
hd layer apply team-baseline --project . --dry-run
```

See [Scenario 7](../../scenarios/details/07-preview-apply-layer.md).

## Profiles vs projects

| | Profiles | Projects |
| --- | --- | --- |
| **Scope** | Machine home harness paths | Repository working tree |
| **Primary command** | `profile use` | `layer apply` |
| **Typical use** | Work/personal machine presets | Team repo baselines |
| **Drift / revert** | Not tracked | `project drift` / `project revert` |

Use [Profiles](./profiles.md) for machine-wide defaults and projects for repository-specific configuration.

## Related

- [Layers](./layers.md) — what you apply
- [Resources](./resources.md) — what scan imports
- [Profiles](./profiles.md) — machine-wide apply
- [Portability limits](../../portability-limits.md) — cross-harness mirror caveats
- [Command reference](../command-reference.md) — `project` and `layer apply`
- [Scenario 7](../../scenarios/details/07-preview-apply-layer.md) — preview and apply
- [Scenario 21](../../scenarios/details/21-detect-drift.md) — detect drift
- [Scenario 27](../../scenarios/details/27-project-sync.md) — project mirror
