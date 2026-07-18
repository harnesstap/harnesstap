# Scenario 12: Drive HarnessTap from scripts or other agents

**Frequency: Occasional** (often daily in CI, less often for interactive
users) · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when another automation layer needs structured output instead of
human text.

Typical commands:

```bash
harnesstap init --format json
harnesstap harness list --format json
harnesstap resource list --format json
harnesstap layer show my-setup --format json
harnesstap layer doctor my-setup --format json
harnesstap history . --format json
harnesstap layer apply my-setup --project . --dry-run --format json
harnesstap resource sync --format json --dry-run
```

**Exit codes worth scripting against**:

- `harnesstap layer doctor` returns **exit code 1** when any doctor check
  reports an error severity finding.
- `harnesstap status --check` returns **exit code 1** when drift exists.
- `harnesstap layer apply --strict-plugin-versions` returns **exit code 2**
  when a pinned plugin's installed version violates its constraint.

This matters for agent-harness optimization because HarnessTap is not only a
human CLI; it can also be the state and serialization layer that other agents
inspect before deciding how to update a repo's assistant environment.
