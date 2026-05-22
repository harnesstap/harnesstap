# Scenario 6: Add plugin constraints to a preset

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when your environment depends on Claude plugins and you want the
preset to describe not just files, but also expected plugin versions.

Typical commands:

```bash
harnessdeck preset add-plugin my-setup formatter@team-marketplace --version "^2.1.0"
harnessdeck preset remove-plugin my-setup formatter@team-marketplace
harnessdeck preset show my-setup
```

This is especially useful for team-wide setups where the harness environment
should stay compatible across machines. See Scenario 16 for enforcing the
constraints in CI.
