# Scenario 11: Start from a built-in layer instead of building from scratch

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want a fast starting point and only need to tailor it for
your repo afterward.

Typical commands:

```bash
harnessdeck init
harnessdeck layer list
harnessdeck project apply nextjs-fullstack --project . --platform codex
```

This is often the fastest path for a new repo: seed starter layers, apply
one, then scan or extend it with project-specific resources later.
