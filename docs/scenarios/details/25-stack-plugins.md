# Scenario 25: Stack multiple plugins

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Apply plugins in order; later plugins override earlier ones for matching resources.

```bash
harnesstap apply team-baseline my-overrides --project .
```

To share the full curated stack with another machine offline, export the workspace with `harnesstap migrate export` (see [Scenario 28](./28-machine-migration.md)) or export individual plugins with `migrate export --plugin` / `migrate import`.
