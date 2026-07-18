# Scenario 33: Mirror with plugin-source fallback

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when `mirror` would fail because the project's **main harness**
has no on-disk resource tree — common in plugin-only repos that ship
`.claude-plugin/plugin.json` and repo-root `skills/` but no `.claude/` directory.
The `--reference` flag chooses which on-disk source drives alias harness output.

Typical commands:

```bash
# Default: main harness only (unchanged behavior)
harnesstap mirror . --dry-run

# Auto fallback: main → plugin source → AGENTS.md instructions
harnesstap mirror . --reference auto --dry-run
harnesstap mirror . --reference auto

# Force plugin-source as the reference
harnesstap mirror . --reference plugin --dry-run

# Force shared AGENTS.md instruction scan across alias harnesses
harnesstap mirror . --reference agents --dry-run

# Shift main harness before mirroring (when codex is the real canonical tree)
harnesstap mirror . --force-shift-reference codex --reference auto
```

**Reference strategies:**

| Strategy | Behavior |
| -------- | -------- |
| `main` (default) | Scan main harness paths only; error if empty. |
| `auto` | Use main harness scan; when main has instructions but no on-disk skills and a plugin manifest is present, merge repo-root plugin `skills/` into the reference. If main is empty, fall back to plugin source, then `AGENTS.md` instruction resources. |
| `plugin` | Use repo-root plugin manifest resources (`skills/`, `commands/`, `hooks/`). |
| `agents` | Use canonical `AGENTS.md` instruction resources from detected AGENTS-based harnesses. |

When mirror fails with an empty main harness, the error suggests:

```text
Try: harnesstap mirror --reference plugin
or harnesstap scan .
or harnesstap harness project set --main codex
```

**Auto-merge (non-empty main):** repos like [obra/superpowers](https://github.com/obra/superpowers)
ship `CLAUDE.md` plus repo-root `skills/` under `.claude-plugin/` with no
`.claude/skills/` tree. `--reference auto` merges plugin skills into the mirror
reference so alias harnesses receive the full skill set — not only when the main
harness tree is completely empty.

Pair with [Scenario 31](./31-dual-mode-plugin-import.md) to import plugin
resources into the local database first. See [Scenario 27](./27-project-sync.md)
for the baseline mirror workflow and [portability limits](../../portability-limits.md)
for harness-specific surfaces that emit mirror warnings (runtime plugins, pi
extensions, Gemini manifests).
