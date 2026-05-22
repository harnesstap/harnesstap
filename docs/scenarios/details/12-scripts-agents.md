# Scenario 12: Drive HarnessDeck from scripts or other agents

**Frequency: Occasional** (often daily in CI, less often for interactive
users) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when another automation layer needs structured output instead of
human text.

Typical commands:

```bash
harnessdeck init --format json
harnessdeck platform list --format json
harnessdeck resource list --format json
harnessdeck preset show my-setup --format json
harnessdeck project history --project . --format json
harnessdeck project apply my-setup --project . --dry-run --format json
```

**Exit codes worth scripting against**:

- `harnessdeck plugin check` returns **exit code 1** when any plugin is
  outdated.
- `harnessdeck plugin update` returns **exit code 1** when any update fails.
- `harnessdeck project apply --strict-plugin-versions` returns **exit code 2**
  when a pinned plugin's installed version violates its constraint.

This matters for agent-harness optimization because HarnessDeck is not only a
human CLI; it can also be the state and serialization layer that other agents
inspect before deciding how to update a repo's assistant environment.
