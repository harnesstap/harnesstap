# Scenario 15: Apply a layer to a subset of target platforms

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a repo opts into some harnesses but not others. For example, a
backend repo that supports Claude Code and Codex but never used Cursor.

Typical commands:

```bash
harnessdeck project apply my-setup --project . --harness claude-code,codex --dry-run
harnessdeck project apply my-setup --project . --harness claude-code,codex
```

The `--harness` flag also lets you migrate one harness at a time: apply only
the new target first, verify the result, then add the remaining harnesses on
a follow-up run.
