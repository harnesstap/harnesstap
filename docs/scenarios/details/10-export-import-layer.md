# Scenario 10: Export or import a layer as a portable bundle

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to move a harness setup between machines, bootstrap a
new repo quickly, or share a team baseline.

Typical commands:

```bash
harnesstap migrate export ./my-setup.harnesstap.toml --layer my-setup
harnesstap migrate export ./team.harnesstap.toml --layer my-setup --embed-plugins
harnesstap migrate import ./my-setup.harnesstap.toml
```

This is the main offline layer sharing story. Bundles carry the layer definition
plus its resources, and `--embed-plugins` inlines Claude marketplace-installed
plugin trees so the receiving machine does not need to re-fetch them at apply
time.
