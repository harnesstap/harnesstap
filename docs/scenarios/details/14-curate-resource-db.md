# Scenario 14: Curate and clean up the local resource DB

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when months of scans have left the local DB with duplicates, stale
resources from deleted repos, or noisy imports you no longer need.

Typical commands:

```bash
harnessdeck resource list --type skill
harnessdeck resource list --type instruction --search legacy
harnessdeck resource list --type plugin
harnessdeck resource show skill:legacy-helper
harnessdeck resource delete legacy-helper
harnessdeck layer delete <stale-layer-name>
```

Valid `--type` values for material resources: `instruction`, `skill`, `rule`,
`mcp_server`, `permission`, `hook`, `agent`, `command`, `env_var`,
`model_config`. `resource list` also shows `plugin` resources; `layer`
composition refs stay hidden unless you inspect a layer directly.

Selectors for `resource show` accept `name`, `type:name`, or
`type:name@namespace` when names collide.
