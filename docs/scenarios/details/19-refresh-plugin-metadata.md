# Scenario 19: Sync plugin resources from install trees

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when plugin install trees on disk have changed and HarnessTap's
library copies are stale or missing resolved versions.

Typical commands:

```bash
harnessdeck resource sync --dry-run
harnessdeck resource sync --overwrite
harnessdeck resource sync formatter@team-marketplace --overwrite --force
```

`resource sync` walks marketplace-linked `plugin` resources and linked child
resources, re-importing from install paths under `~/.claude/plugins`,
`~/.cursor/plugins`, and similar locations. Rows marked stale usually mean the
plugin is not installed locally yet.

For layer-level validation of plugin refs and version constraints, use
`harnesstap layer doctor my-setup --check plugin-metadata`.
