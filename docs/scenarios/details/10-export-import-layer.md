# Scenario 10: Export or import a layer as a portable bundle

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to move a harness setup between machines, bootstrap a
new repo quickly, or share a team baseline.

Typical commands:

```bash
harnessdeck layer export my-setup --file ./my-setup.harnessdeck.json
harnessdeck layer export my-setup --file ./team.harnessdeck.json --embed-plugins
harnessdeck layer import ./my-setup.harnessdeck.json
```

This is the main sharing story today. Bundles carry the layer definition
plus its resources, and `--embed-plugins` inlines Claude marketplace-installed
plugin trees so the receiving machine does not need to re-fetch them at apply
time.
