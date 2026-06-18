# Scenario 25: Stack multiple layers

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Apply layers in order; later layers override earlier ones for matching resources.

```bash
harnessdeck layer apply team-baseline my-overrides --project .
```

To share the full curated stack with another machine offline, export the workspace with `harnessdeck migrate export` (see [Scenario 28](./28-machine-migration.md)) or export individual layers with `migrate export --layer` / `migrate import`.
