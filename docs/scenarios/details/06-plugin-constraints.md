# Scenario 6: Add plugin constraints to a layer

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when your environment depends on Claude plugins and you want the
layer to describe not just files, but also expected plugin versions.

Typical commands:

```bash
harnessdeck layer combine my-setup formatter@team-marketplace --type plugin --version "^2.1.0"
harnessdeck layer uncombine my-setup formatter@team-marketplace --type plugin
harnessdeck layer show my-setup
```

This is especially useful for team-wide setups where the harness environment
should stay compatible across machines. See Scenario 16 for enforcing the
constraints in CI.
