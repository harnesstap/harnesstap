# Scenario 23: Doctor-check a plugin without writing

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want validation feedback on a plugin definition before
applying it to a project.

```bash
harnesstap plugin doctor my-setup
harnesstap plugin doctor my-setup --format json
harnesstap plugin doctor --list-checks
harnesstap plugin doctor my-setup --check plugin-metadata
```

Doctor checks cover empty plugins, duplicate resources, empty content, and
plugin metadata. JSON mode exits with code `1` when the plugin is invalid.
