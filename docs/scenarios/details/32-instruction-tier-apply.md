# Scenario 32: Apply to instruction-tier harnesses

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when applying a layer to harnesses that load skills as **always-on
instructions or rules** rather than agent-requested skill directories. Harnesses
with registry `skillEmission: instruction-only` include `windsurf`, `cline`,
`github-copilot`, `gemini-cli`, and `kiro`.

Typical commands:

```bash
# Preview per-harness output paths
harnessdeck layer apply my-setup --project . --harness windsurf,cline,github-copilot --dry-run

# Apply to instruction-tier harnesses alongside native-skill hosts
harnessdeck layer apply my-setup --project . --harness claude-code,codex,windsurf,cursor

# List all harnesses; instruction-tier hosts have skillEmission: instruction-only
harnessdeck harness list --format json
```

**Expected emission paths** (instruction-tier hosts):

| Harness | Skills become |
| ------- | ------------- |
| `windsurf` | `.windsurf/rules/{name}.md` |
| `cline` | `.clinerules/{name}.md` (or merged rules file) |
| `github-copilot` | Sections in `.github/copilot-instructions.md` |
| `gemini-cli` | Rules/instructions per Gemini serializer paths |
| `kiro` | `.kiro/steering/{name}.md` |

Native-skill hosts (`claude-code`, `codex`, `cursor` with default mode, etc.)
continue to emit `.claude/skills/`, `.agents/skills/`, or harness-specific skill
directories.

### Cursor `cursor_skill_mode`

Cursor is not instruction-only by default. Project apply and mirror read
`cursor_skill_mode` from project harness config and pass it to the serializer
as `skillCursorMode`:

| `cursor_skill_mode` | Skill output |
| ------------------- | ------------ |
| `agent-requested` (default) | `.cursor/rules/*.mdc`, `alwaysApply: false` |
| `always-on` | `.cursor/rules/*.mdc`, `alwaysApply: true` |
| `agents-skills` | `.agents/skills/{name}/SKILL.md` |

```bash
harnessdeck harness project status --project . --format json
```

Compare dry-run output across harnesses before writing. See
[portability limits](../../portability-limits.md) for intentional per-host
tailoring vs hand-tuned adapter copies.
