# Scenario 18: Debug committed vs effective Claude plugin settings

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when the plugin set declared in the project's
`.claude/settings.json` differs from what Claude Code actually loads after
merging user, project, and local scopes.

Typical commands:

```bash
harnessdeck project scan . --harness claude-code --dry-run
harnessdeck project scan . --harness claude-code
harnessdeck resource list --type plugin
harnessdeck resource show formatter@team-marketplace --all-fields
harnessdeck layer show my-setup
```

Start by re-scanning the project so HarnessDeck captures the current committed
plugin declarations in the library. Then compare:

- **Committed** plugins — what the repo declares in `.claude/settings.json`
- **Effective behavior** — what Claude loads after scope merge, often explained
  by a `~/.claude/settings.json` user-scope entry that overrides the project

`layer show` reveals which plugin pins a layer expects at apply time.
`project apply --strict-plugin-versions` is the enforcement path when you want
CI or automation to fail on a mismatch.

There is no longer a dedicated `plugin list` / `plugin show` inventory
command; inspect the settings files directly when scope merge is the root
cause.
