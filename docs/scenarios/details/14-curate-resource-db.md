# Scenario 14: Curate and clean up the local resource DB

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when months of scans have left the local DB with duplicates, stale
resources from deleted repos, or noisy imports you no longer need.

Typical commands:

```bash
harnessdeck resource list --type skill
harnessdeck resource list --type instruction --search legacy
harnessdeck resource show <id>
harnessdeck resource delete <id>
harnessdeck layer delete <stale-layer-name>
```

Valid `--type` values: `instruction`, `skill`, `rule`, `mcp_server`,
`permission`, `hook`, `agent`, `command`, `env_var`, `model_config`.
