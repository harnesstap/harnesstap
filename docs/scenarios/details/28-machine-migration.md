# Scenario 28: One-command machine migration

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when moving HarnessDeck state to a new machine or sharing your curated
workspace with a teammate offline. The archive includes layers, environments
(secret refs only), harness preferences, and config in one step.

```bash
harnessdeck migrate export ./harnessdeck-state.tar.gz --include-plugins
harnessdeck migrate import ./harnessdeck-state.tar.gz
```

For a manual layer-by-layer export workflow, see [Scenario 17](./17-migrate-state.md).

For multiplayer distribution, publish layers to HarnessDeck Cloud with
`layer publish` / `layer pull` instead.
