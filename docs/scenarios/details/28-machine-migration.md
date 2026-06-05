# Scenario 28: One-command machine migration

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

```bash
harnessdeck migrate export ./harnessdeck-state.tar.gz --include-plugins
harnessdeck migrate import ./harnessdeck-state.tar.gz
```

---

## Common

Use these when starting or adopting a repository, applying a layer, or when
one repo needs different harness defaults than your machine-wide setup.
