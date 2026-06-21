# Scenario 4: Scan an existing repository and import its current harness setup

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a repository already contains agent instructions, skills, MCP
config, rules, hooks, or agent files that you want HarnessDeck to manage.

Typical commands:

```bash
harnessdeck scan . --dry-run                  # preview what would be imported
harnessdeck scan .
harnessdeck scan . --harness claude-code     # scope to a single harness
harnessdeck resource list
harnessdeck resource show <resource-name-or-id>
```

This is the normal "adopt an existing repo" workflow. It works well for repos
that already contain files such as `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`,
`.cursor/rules/`, `.codex/config.toml`, and similar harness-specific layouts.

Re-scanning is idempotent within a run: resources deduplicate by `type:name`
before insertion, so running the same scan twice does not create duplicate
records.
