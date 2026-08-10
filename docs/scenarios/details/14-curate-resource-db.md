# Scenario 14: Curate and clean up the local resource DB

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when months of scans have left the local DB with duplicates, stale
resources from deleted repos, or noisy imports you no longer need.

Typical commands:

```bash
harnesstap resource list --type skill
harnesstap resource list --type instruction --search legacy
harnesstap resource list --type plugin_pin_pin
harnesstap resource show skill:legacy-helper
harnesstap resource delete legacy-helper
harnesstap plugin delete <stale-plugin-name>
```

Valid `--type` values for material resources: `instruction`, `skill`, `rule`,
`mcp_server`, `permission`, `hook`, `agent`, `command`, `env_var`,
`model_config`. `resource list` also shows `plugin` resources; `plugin`
composition refs stay hidden unless you inspect a plugin directly.

Selectors for `resource show` accept `name`, `type:name`, or
`type:name@namespace` when names collide.
