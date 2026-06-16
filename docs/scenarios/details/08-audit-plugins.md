# Scenario 8: Audit plugin resources and layer pins

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to understand which plugin resources are in the local
library, which plugin pins a layer carries, and whether installed plugin trees
are still in sync with HarnessDeck.

There are two related surfaces:

**Library plugin resources** — what HarnessDeck knows about installed plugins:

```bash
harnessdeck resource list --type plugin_pin_pin
harnessdeck resource show formatter@team-marketplace
harnessdeck resource sync --dry-run
harnessdeck resource sync formatter@team-marketplace --overwrite
```

`resource sync` refreshes marketplace-linked plugin resources from install
trees under `~/.claude/plugins`, `~/.cursor/plugins`, and similar locations.
Stale rows are reported when the install path cannot be resolved.

**Layer pins** — what a layer expects at apply time:

```bash
harnessdeck layer show my-setup
harnessdeck layer doctor my-setup --check plugin-metadata
harnessdeck project apply my-setup --project . --dry-run --strict-plugin-versions
```

Use **library sync** when chasing *"is this plugin resource up to date?"* and
**layer pins + apply validation** when chasing *"does this project satisfy the
layer's plugin constraints?"*. See Scenario 18 for debugging when committed
project settings and effective Claude plugin loads disagree.
