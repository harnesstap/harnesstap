# Scenario 2: Choose your registered harnesses

**Frequency: Occasional** (once after init, then when your toolchain changes) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to pick which harnesses HarnessTap writes to. All
registered harnesses are equal: apply, status and drift cover the whole set.
The first registered harness is only a default, used as the `mirror` source
and for single-harness scans when you do not name one.

Typical commands:

```bash
harnesstap harness set --harnesses claude-code,cursor,codex
harnesstap harness status
```

Put the harness you want as the default first in the list. For one project,
use `harnesstap harness project set --harnesses ...` instead.

Notes:

- `harnesstap harness list` is the source of truth for valid harness IDs.
- `--interactive` is available, but the non-interactive flag path is the main
  automation-friendly workflow.
