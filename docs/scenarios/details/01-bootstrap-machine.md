# Scenario 1: Bootstrap HarnessDeck on a machine and discover existing defaults

**Frequency: Occasional** (typically once per machine) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when setting up HarnessDeck for the first time on a laptop, dev box,
or CI-like agent environment.

Typical commands:

```bash
harnessdeck init
harnessdeck platform list
harnessdeck preset list
```

What this gives you:

- a local SQLite database under `~/.harnessdeck/harnessdeck.db`
- an optional settings file at `~/.harnessdeck/config.json` (e.g. plugin
  refresh cadence — see Scenario 19)
- built-in starter presets seeded into the database
- imported resources from supported home-directory harness folders when
  present (`~/.claude/`, `~/.codex/`, …)
- a quick view of which harnesses the current release knows how to handle

Follow with Scenario 2 to choose a main harness and alias set — init does not
prompt for that today.
