# Scenario 10: Export or import a plugin as a portable package

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to move a harness setup between machines, bootstrap a
new repo quickly, or share a team baseline.

Typical commands:

```bash
harnesstap migrate export ./my-setup --plugin my-setup
harnesstap migrate export ./my-setup.ap.json --plugin my-setup --single-file
harnesstap migrate export ./team --plugin my-setup --embed-plugins
harnesstap migrate import ./my-setup
harnesstap migrate import ./my-setup.ap.json
```

This is the main offline plugin sharing story. Packages carry the plugin as an
Agent Plugins directory (or `.ap.json` envelope), and `--embed-plugins` inlines
dependency trees under `com.harnesstap/embedded/` so the receiving machine does
not need to re-fetch them at apply time.
