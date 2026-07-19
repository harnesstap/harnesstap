# Scenario 23: Doctor-check a layer without writing

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want validation feedback on a layer definition before
applying it to a project.

```bash
harnesstap layer doctor my-setup
harnesstap layer doctor my-setup --format json
harnesstap layer doctor --list-checks
harnesstap layer doctor my-setup --check plugin-metadata
```

Doctor checks cover empty layers, duplicate resources, empty content, and
plugin metadata. JSON mode exits with code `1` when the layer is invalid.
