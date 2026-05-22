# Scenario 16: Enforce preset and plugin state in CI

**Frequency: Occasional** (per-project; in CI it runs on every PR) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want CI to fail if the project drifts away from its preset
or its pinned plugin versions.

Typical commands (each exits non-zero on a problem):

```bash
harnessdeck plugin check --format json
harnessdeck project apply my-setup --project . --dry-run --strict-plugin-versions --format json
```

This pairs naturally with Scenario 12. The `--dry-run` keeps CI from writing
files, while `--strict-plugin-versions` forces failure (exit 2) on a pin
violation. Use `plugin check` exit code 1 as the "plugins are stale" signal
in a separate job or step.
