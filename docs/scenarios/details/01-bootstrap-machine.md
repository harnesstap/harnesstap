# Scenario 1: Bootstrap HarnessDeck on a machine and discover existing defaults

**Frequency: Occasional** (typically once per machine) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when setting up HarnessDeck for the first time on a laptop, dev box,
or CI-like agent environment.

Typical commands:

```bash
harnessdeck init
harnessdeck init --main claude-code --aliases cursor,codex
harnessdeck platform list
harnessdeck layer list
```

What this gives you:

- a local SQLite database under `~/.harnessdeck/harnessdeck.db`
- an optional settings file at `~/.harnessdeck/config.json` (e.g. plugin
  refresh cadence — see Scenario 19)
- built-in starter layers seeded into the database
- imported resources from supported home-directory harness folders when
  present (`~/.claude/`, `~/.codex/`, …)
- a quick view of which harnesses the current release knows how to handle

If you skip harness selection during init or want to change it later, use
[Scenario 2](./02-default-harness-aliases.md) to update the default main harness and alias set.
