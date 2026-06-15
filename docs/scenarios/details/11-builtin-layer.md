# Scenario 11: Start from a catalog baseline instead of building from scratch

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want a fast starting point and only need to tailor it for
your repo afterward.

Typical commands:

```bash
harnessdeck init --main codex --aliases claude-code,cursor
harnessdeck layer search foundation
harnessdeck project apply engineering-foundation
```

This is often the fastest path for a new repo: apply a public catalog baseline,
then scan or extend it with project-specific resources later.

Bare names such as `engineering-foundation` resolve against the `harnessdeck-cloud`
public catalog (and any connected orgs or libraries). Use `layer pull` when you
want the bundle cached locally before going offline.
