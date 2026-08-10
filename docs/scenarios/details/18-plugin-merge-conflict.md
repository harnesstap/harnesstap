# Scenario 18: Debug committed vs effective Claude plugin settings

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when the plugin set declared in the project's
`.claude/settings.json` differs from what Claude Code actually loads after
merging user, project, and local scopes.

Typical commands:

```bash
harnesstap scan . --harness claude-code --dry-run
harnesstap scan . --harness claude-code
harnesstap resource list --type plugin_pin_pin
harnesstap resource show formatter@team-marketplace --all-fields
harnesstap plugin show my-setup
```

Start by re-scanning the project so HarnessTap captures the current committed
plugin declarations in the library. Then compare:

- **Committed** plugins — what the repo declares in `.claude/settings.json`
- **Effective behavior** — what Claude loads after scope merge, often explained
  by a `~/.claude/settings.json` user-scope entry that overrides the project

`plugin show` reveals which plugin pins a plugin expects at apply time.
`apply --strict-plugin-versions` is the enforcement path when you want
CI or automation to fail on a mismatch.

When scope merge is the root cause, inspect `.claude/settings.json` in the
repo and `~/.claude/settings.json` at user scope directly.
