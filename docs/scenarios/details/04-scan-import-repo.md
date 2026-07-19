# Scenario 4: Scan an existing repository and import its current harness setup

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a repository already contains agent instructions, skills, MCP
config, rules, hooks, or agent files that you want HarnessTap to manage.

Typical commands:

```bash
harnesstap scan . --dry-run                  # preview what would be imported
harnesstap scan .
harnesstap scan . --harness claude-code     # scope to a single harness
harnesstap resource list
harnesstap resource show <resource-name-or-id>
```

This is the normal "adopt an existing repo" workflow. It works well for repos
that already contain files such as `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`,
`.cursor/rules/`, `.codex/config.toml`, and similar harness-specific layouts.

Re-scanning is idempotent within a run: resources deduplicate by `type:name`
before insertion, so running the same scan twice does not create duplicate
records.
