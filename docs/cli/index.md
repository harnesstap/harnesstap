# HarnessTap CLI documentation

HarnessTap is an agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs. Scan existing setup, store canonical resources, compose plugins, and materialize into any supported harness.

## Start here

- [Getting started](./getting-started.md) — install, first apply, scan and publish workflow
- [Concepts](./concepts/overview.md) — architecture and the HarnessTap data model
- [Command reference](./command-reference.md) — full CLI surface, flags, and aliases

## Guides

- [Scenarios](../scenarios/scenarios.md) — numbered workflow playbooks
- [Supported harnesses](../supported-harnesses.md) — harness matrix and resource types
- [Portability limits](../portability-limits.md) — what transfers across harnesses
- [Interactive UX](./interactive-ux.md) — keyboard reference for TTY browse prompts
- [HarnessTap Cloud](./cloud.md) — authenticate, search, pull, and publish shared plugins
- [Pack a bundle](./author/pack.md) — Author ramp: emit an Agent Plugins 1.0 bundle from `apm.yml`

## Quick links

```bash
ht init --main codex --aliases claude-code,cursor
ht plugin list --search foundation --remote-only
ht apply engineering-foundation
ht status .
```

Use `ht` as shorthand for `harnesstap`. For automation, prefer `--format json` on reporting commands.
