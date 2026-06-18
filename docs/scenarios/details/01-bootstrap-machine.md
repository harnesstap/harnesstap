# Scenario 1: Bootstrap HarnessDeck on a machine and discover existing defaults

**Frequency: Occasional** (typically once per machine) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when setting up HarnessDeck for the first time on a laptop, dev box,
or CI-like agent environment.

Typical commands:

```bash
harnessdeck init
harnessdeck init --main claude-code --aliases cursor,codex
harnessdeck harness list
harnessdeck layer search fullstack
```

What this gives you:

- a local SQLite database under `~/.harnessdeck/harnessdeck.db`
- an optional settings file at `~/.harnessdeck/config.jsonc`
- a `default` profile layer (tagged `profile`) and
  `~/.harnessdeck/active-profile.json` unless you pass `--no-default-profile`
- imported resources from supported home-directory harness folders when
  present (`~/.claude/`, `~/.codex/`, …)
- a quick view of which harnesses the current release knows how to handle

`init` does not run global apply. After bootstrap, run
`harnessdeck profile use default` (see [Scenario 36](./36-switch-profile.md))
to materialize home harness files.

Catalog baselines are not seeded at init. Apply them to projects with
`layer apply <name>` (see [Scenario 11](./11-builtin-layer.md)) or cache them
first with `layer pull`.

If you skip harness selection during init or want to change it later, use
[Scenario 2](./02-default-harness-aliases.md) to update the default main harness and alias set.
