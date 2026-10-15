# Scenario 33: Mirror with plugin-source fallback

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when `mirror` would fail because the project's **first registered harness**
has no on-disk resource tree: common in plugin-only repos that ship
`.claude-plugin/plugin.json` and repo-root `skills/` but no `.claude/` directory.
The `--reference` flag chooses which on-disk source drives the other harnesses.

Typical commands:

```bash
# Default: first registered harness only (unchanged behavior)
harnesstap mirror . --dry-run

# Auto fallback: first registered harness, then plugin source, then AGENTS.md instructions
harnesstap mirror . --reference auto --dry-run
harnesstap mirror . --reference auto

# Force plugin-source as the reference
harnesstap mirror . --reference plugin --dry-run

# Force shared AGENTS.md instruction scan across registered harnesses
harnesstap mirror . --reference agents --dry-run

# Mirror from another harness (when codex is the real canonical tree)
harnesstap mirror . --from codex --reference auto
```

**Reference strategies:**

| Strategy | Behavior |
| -------- | -------- |
| `disk` (default) | Scan the first registered harness paths only (or `--from`); error if empty. `main` is a deprecated alias. |
| `auto` | Use the first registered harness scan; when it has instructions but no on-disk skills and a plugin manifest is present, merge repo-root plugin `skills/` into the reference. If it is empty, fall back to plugin source, then `AGENTS.md` instruction resources. |
| `plugin` | Use repo-root plugin manifest resources (`skills/`, `commands/`, `hooks/`). |
| `agents` | Use canonical `AGENTS.md` instruction resources from detected AGENTS-based harnesses. |

When mirror fails with an empty first registered harness, the error suggests:

```text
Try: harnesstap mirror --reference plugin
or harnesstap scan .
or harnesstap harness project set --harnesses claude-code,cursor
```

**Auto-merge (non-empty first registered harness):** repos like [obra/superpowers](https://github.com/obra/superpowers)
ship `CLAUDE.md` plus repo-root `skills/` under `.claude-plugin/` with no
`.claude/skills/` tree. `--reference auto` merges plugin skills into the mirror
reference so the other harnesses receive the full skill set: not only when the
first registered harness tree is completely empty.

Pair with [Scenario 31](./31-dual-mode-plugin-import.md) to import plugin
resources into the local database first. See [Scenario 27](./27-project-sync.md)
for the baseline mirror workflow and [portability limits](../../portability-limits.md)
for harness-specific surfaces that emit mirror warnings (runtime plugins, pi
extensions, Gemini manifests).
