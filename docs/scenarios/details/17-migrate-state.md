# Scenario 17: Migrate HarnessDeck state to a new machine

**Frequency: Rare** · **Status: Shipped (manual workflow — see [Scenario 28](./28-machine-migration.md) for one-command migration)**

[← Back to scenarios index](../scenarios.md)

Use this when moving setups across laptops or onto a dev box. For a single
archive that includes harness preferences and config, prefer [Scenario 28](./28-machine-migration.md).

Manual workflow with current commands:

```bash
# On the old machine
mkdir -p ./bundles
for p in $(harnessdeck layer list --format json | jq -r '.[].name'); do
  harnessdeck migrate export "./bundles/$p.harnessdeck.toml" --layer "$p" --embed-plugins
done

# Copy ./bundles/ to the new machine, then:
harnessdeck init
for f in ./bundles/*.harnessdeck.toml; do
  harnessdeck migrate import "$f"
done
harnessdeck harness set --main claude-code --aliases cursor,codex   # restore selection
```

`--embed-plugins` is recommended for portability so the new machine does not
need to re-fetch marketplace plugin trees. This workflow does not currently
carry over harness preferences or `~/.harnessdeck/config.json`; copy those by
hand or use [Scenario 28](./28-machine-migration.md).
