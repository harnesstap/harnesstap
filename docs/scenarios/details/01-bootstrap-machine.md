# Scenario 1: Bootstrap HarnessTap on a machine and discover existing defaults

**Frequency: Occasional** (typically once per machine) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when setting up HarnessTap for the first time on a laptop, dev box,
or CI-like agent environment.

Typical commands:

```bash
harnesstap init
harnesstap init --main claude-code --aliases cursor,codex
harnesstap harness list
harnesstap plugin list --search fullstack --remote-only
```

What this gives you:

- a local SQLite database under `~/.harnesstap/harnesstap.db`
- an optional settings file at `~/.harnesstap/config.jsonc`
- a `global default` profile plugin (tagged `profile`) and
  `~/.harnesstap/active-profile.json` unless you pass `--no-default-profile`
- imported resources from supported home-directory harness folders when
  present (`~/.claude/`, `~/.codex/`, …)
- a quick view of which harnesses the current release knows how to handle

`init` does not run global apply. After bootstrap, run
`harnesstap profile use "global default"` (see [Scenario 36](./36-switch-profile.md))
to materialize home harness files.

Catalog baselines are not seeded at init. Apply them to projects with
`apply <name>` (see [Scenario 11](./11-builtin-plugin.md)) or cache them
first with `plugin pull`.

If you skip harness selection during init or want to change it later, use
[Scenario 2](./02-default-harness-aliases.md) to update the default main harness and alias set.
