# Scenario 29: Apply a curated deck to a project

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a team maintains a **deck** — an ordered stack of layers plus
environments — and you want to materialize that stack onto a project in one
step instead of listing every layer name.

A deck is a local database record (often imported from a git repo with
`.harnessdeck/deck.toml`). Inspect it before applying, then write harness files
the same way as [Scenario 7](./07-preview-apply-layer.md).

Typical commands:

```bash
harnessdeck deck import ./team-deck
harnessdeck deck show team-platform
harnessdeck deck apply team-platform --project . --dry-run
harnessdeck deck apply team-platform --project .
harnessdeck project status .
```

Stack personal or team overrides on top of the deck (same merge semantics as
[Scenario 25](./25-stack-layers.md)):

```bash
harnessdeck deck apply team-platform my-overrides --project .
```

**Apply entry points**

| Goal | Command |
| --- | --- |
| One or more layers | `harnessdeck layer apply <layer...>` |
| A curated deck stack | `harnessdeck deck apply <deck> [override-layers...]` |
| Legacy alias | `harnessdeck project apply` (deprecated; use `layer apply`) |

`deck apply` uses the deck's **active environment** in the environment cascade
even when `--project` points at a different directory than the deck's
`root_path`. Use `environment use --project <path>` to switch deck-scoped env
without re-importing layers.

See also [Scenario 30](./30-manage-deck-records.md) for listing and deleting
deck records.
