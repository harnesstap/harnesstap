# Scenario 16: Enforce layer and plugin state in CI

**Frequency: Occasional** (per-project; in CI it runs on every PR) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want CI to fail if the project drifts away from its layer
or its pinned plugin versions.

Typical commands (each exits non-zero on a problem):

```bash
harnessdeck status . --check --format json
harnessdeck layer doctor my-setup --format json
harnessdeck layer apply my-setup --project . --dry-run --strict-plugin-versions --format json
harnessdeck resource sync --format json --dry-run
```

This pairs naturally with Scenario 12. The `--dry-run` keeps CI from writing
files, while `--strict-plugin-versions` forces failure (exit 2) on a pin
violation. Use `status --check` exit code 1 as the "working tree changed
since last apply/sync" signal, and `layer doctor` exit code 1 as the "layer
definition is invalid" signal.
