# Scenario 28: One-command machine migration

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when moving HarnessTap state to a new machine or sharing your curated
workspace with a teammate offline. The archive includes layers, environments
(secret refs only), harness preferences, and config in one step.

```bash
harnesstap migrate export ./harnesstap-state.tar.gz --include-plugins
harnesstap migrate import ./harnesstap-state.tar.gz
```

For a manual layer-by-layer export workflow, see [Scenario 17](./17-migrate-state.md).

For multiplayer distribution, publish layers to HarnessTap Cloud with
`layer publish` / `layer pull` instead.
