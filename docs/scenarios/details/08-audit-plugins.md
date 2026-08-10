# Scenario 8: Audit plugin resources and plugin pins

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to understand which plugin resources are in the local
library, which plugin pins a plugin carries, and whether installed plugin trees
are still in sync with HarnessTap.

There are two related surfaces:

**Library plugin resources** — what HarnessTap knows about installed plugins:

```bash
harnesstap resource list --type plugin_pin_pin
harnesstap resource show formatter@team-marketplace
harnesstap resource sync --dry-run
harnesstap resource sync formatter@team-marketplace --overwrite
```

`resource sync` refreshes marketplace-linked plugin resources from install
trees under `~/.claude/plugins`, `~/.cursor/plugins`, and similar locations.
Stale rows are reported when the install path cannot be resolved.

**Plugin pins** — what a plugin expects at apply time:

```bash
harnesstap plugin show my-setup
harnesstap plugin doctor my-setup --check plugin-metadata
harnesstap apply my-setup --project . --dry-run --strict-plugin-versions
```

Use **library sync** when chasing *"is this plugin resource up to date?"* and
**plugin pins + apply validation** when chasing *"does this project satisfy the
plugin's plugin constraints?"*. See Scenario 18 for debugging when committed
project settings and effective Claude plugin loads disagree.
