# Scenario 2: Choose a default main harness and alias harnesses

**Frequency: Occasional** (once after init, then when your toolchain changes) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want one harness to be your canonical setup and a few
others to be kept aligned with it.

Typical commands:

```bash
harnessdeck harness set --main claude-code --aliases cursor,codex
harnessdeck harness status
```

Notes:

- `harnessdeck harness list` is the source of truth for valid harness IDs.
- `--interactive` is available, but the non-interactive flag path is the main
  automation-friendly workflow.
