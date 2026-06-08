# Scenario 28: One-command machine migration

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when moving HarnessDeck state to a new machine in one archive that
includes layers, harness preferences, and config.

```bash
harnessdeck migrate export ./harnessdeck-state.tar.gz --include-plugins
harnessdeck migrate import ./harnessdeck-state.tar.gz
```

For a manual layer-by-layer export workflow, see [Scenario 17](./17-migrate-state.md).
