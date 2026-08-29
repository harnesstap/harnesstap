# Scenario 16: Enforce plugin and plugin state in CI

**Frequency: Occasional** (per-project; in CI it runs on every PR) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want CI to fail if the project drifts away from its plugin
or its pinned plugin versions.

Typical commands (each exits non-zero on a problem):

```bash
harnesstap status . --check --format json
harnesstap plugin doctor my-setup --format json
harnesstap apply my-setup --project . --dry-run --strict-plugin-versions --format json
harnesstap resource sync --format json --dry-run
harnesstap audit --ci --format json
```

This pairs naturally with Scenario 12. The `--dry-run` keeps CI from writing
files, while `--strict-plugin-versions` forces failure (exit 2) on a pin
violation. Use `status --check` exit code 1 as the "working tree changed
since last apply/sync" signal, and `plugin doctor` exit code 1 as the "plugin
definition is invalid" signal.
