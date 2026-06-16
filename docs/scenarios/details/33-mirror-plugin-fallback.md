# Scenario 33: Mirror with plugin-source fallback

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when `project mirror` would fail because the project's **main harness**
has no on-disk resource tree — common in plugin-only repos that ship
`.claude-plugin/plugin.json` and repo-root `skills/` but no `.claude/` directory.
The `--reference` flag chooses which on-disk source drives alias harness output.

Typical commands:

```bash
# Default: main harness only (unchanged behavior)
harnessdeck project mirror . --dry-run

# Auto fallback: main → plugin source → AGENTS.md instructions
harnessdeck project mirror . --reference auto --dry-run
harnessdeck project mirror . --reference auto

# Force plugin-source as the reference
harnessdeck project mirror . --reference plugin --dry-run

# Force shared AGENTS.md instruction scan across alias harnesses
harnessdeck project mirror . --reference agents --dry-run

# Shift main harness before mirroring (when codex is the real canonical tree)
harnessdeck project mirror . --force-shift-reference codex --reference auto
```

**Reference strategies:**

| Strategy | Behavior |
| -------- | -------- |
| `main` (default) | Scan main harness paths only; error if empty. |
| `auto` | Try main harness, then plugin source, then `AGENTS.md` instruction resources. |
| `plugin` | Use repo-root plugin manifest resources (`skills/`, `commands/`, `hooks/`). |
| `agents` | Use canonical `AGENTS.md` instruction resources from detected AGENTS-based harnesses. |

When mirror fails with an empty main harness, the error suggests:

```text
Try: harnessdeck project mirror --reference plugin
or harnessdeck project scan .
or harnessdeck harness project set --main codex
```

Pair with [Scenario 31](./31-dual-mode-plugin-import.md) to import plugin
resources into the local database first. See [Scenario 27](./27-project-sync.md)
for the baseline mirror workflow and [portability limits](../portability-limits.md)
for harness-specific surfaces that emit mirror warnings (runtime plugins, pi
extensions, Gemini manifests).
