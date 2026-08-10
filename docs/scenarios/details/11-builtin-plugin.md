# Scenario 11: Start from a catalog baseline instead of building from scratch

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want a fast starting point and only need to tailor it for
your repo afterward.

Typical commands:

```bash
harnesstap init --main codex --aliases claude-code,cursor
harnesstap plugin list --search foundation --remote-only
harnesstap apply engineering-foundation
```

This is often the fastest path for a new repo: apply a public catalog baseline,
then scan or extend it with project-specific resources later.

Bare names such as `engineering-foundation` resolve against the `harnesstap-cloud`
public catalog (and any connected orgs or libraries). Use `plugin pull` when you
want the bundle cached locally before going offline.
