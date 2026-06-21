# HarnessDeck CLI documentation

HarnessDeck is an agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs. Scan existing setup, store canonical resources, compose layers, and materialize into any supported harness.

## Start here

- [Getting started](./getting-started.md) — install, first apply, scan and publish workflow
- [Concepts](./concepts/overview.md) — architecture and the HarnessDeck data model
- [Command reference](./command-reference.md) — full CLI surface, flags, and aliases

## Guides

- [Scenarios](../scenarios/scenarios.md) — numbered workflow playbooks
- [Supported harnesses](../supported-harnesses.md) — harness matrix and resource types
- [Portability limits](../portability-limits.md) — what transfers across harnesses
- [Interactive UX](./interactive-ux.md) — keyboard reference for TTY browse prompts
- [HarnessDeck Cloud](./cloud.md) — authenticate, search, pull, and publish shared layers

## Quick links

```bash
hd init --main codex --aliases claude-code,cursor
hd layer search foundation
hd layer apply engineering-foundation
hd project status .
```

Use `hd` as shorthand for `harnessdeck`. For automation, prefer `--format json` on reporting commands.
