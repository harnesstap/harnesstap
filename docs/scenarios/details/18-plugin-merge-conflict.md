# Scenario 18: Debug a Claude plugin merge conflict (committed vs effective)

**Frequency: Rare** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when `plugin list` shows that the committed plugin set in
`.claude/settings.json` differs from the effective set Claude actually loads.

Typical commands:

```bash
harnessdeck plugin list .
harnessdeck plugin show formatter@team-marketplace .
```

`plugin show` reveals which scope (user, project, local) declares the plugin
and which version wins after the merge. That is usually enough to explain
unexpected behavior like *"I removed this plugin but Claude still loads it"*
— a `~/.claude/settings.json` user-scope entry typically wins over the
project scope.

---
