# Scenario 3: Override harness preferences for one repository

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when your global preference is not the right fit for a specific repo.
For example, you may usually author in Claude Code but want one project to use
Codex as the canonical harness.

Typical commands:

```bash
harnesstap harness project set --project . --main codex --aliases claude-code,cursor
harnesstap harness project status --project .
```

You can also set `--materialization-strategy symlink-preferred` or `copy` when
the project needs a specific write strategy. See Scenario 13 for the tradeoff.
