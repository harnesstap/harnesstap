# Scenario 17: Migrate HarnessTap state to a new machine

**Frequency: Rare** · **Status: Shipped (manual workflow — see [Scenario 28](./28-machine-migration.md) for one-command migration)**

[← Back to scenarios index](../scenarios.md)

Use this when moving setups across laptops or onto a dev box. For a single
archive that includes harness preferences and config, prefer [Scenario 28](./28-machine-migration.md).

Manual workflow with current commands:

```bash
# On the old machine
mkdir -p ./bundles
for p in $(harnesstap plugin list --format json | jq -r '.[].name'); do
  harnesstap migrate export "./bundles/$p.harnesstap.toml" --plugin "$p" --embed-plugins
done

# Copy ./bundles/ to the new machine, then:
harnesstap init
for f in ./bundles/*.harnesstap.toml; do
  harnesstap migrate import "$f"
done
harnesstap harness set --main claude-code --aliases cursor,codex   # restore selection
```

`--embed-plugins` is recommended for portability so the new machine does not
need to re-fetch marketplace plugin trees. This workflow does not currently
carry over harness preferences or `~/.harnesstap/config.json`; copy those by
hand or use [Scenario 28](./28-machine-migration.md).
