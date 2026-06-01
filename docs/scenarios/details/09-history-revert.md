# Scenario 9: Review project state, history, and recover from a bad apply

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a layer write produced files you want to inspect or undo.

Typical commands:

```bash
harnessdeck project status .
harnessdeck project history --project .
harnessdeck project revert <snapshot-id>
```

This is the safety-net workflow. Snapshots are created during `project apply`
**only when the project has a git `origin`** — repos without a remote will
see an empty history and have nothing to revert to. If you need this safety
net for a local-only repo, push to a remote (even a local bare repo) before
applying.
