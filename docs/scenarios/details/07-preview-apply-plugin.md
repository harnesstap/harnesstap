# Scenario 7: Preview and apply a plugin to one or more target harnesses

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you are ready to materialize a known-good setup into a project.
The dry-run preview is itself a frequent check before a real write.

Typical commands:

```bash
harnesstap apply my-setup --project . --harness claude-code,codex,cursor --dry-run
harnesstap apply my-setup --project . --harness claude-code,codex,cursor
harnesstap status .
```

Plugin-version policy when the plugin carries plugin pins:

```bash
harnesstap apply my-setup --strict-plugin-versions   # exit 2 on pin violation
harnesstap apply my-setup --ignore-plugin-versions   # skip validation
```

`apply` is the canonical write path for one or more plugins. Stack multiple plugins in one command (see [Scenario 25](./25-stack-plugins.md)).

Important distinction: applying a plugin writes a known baseline onto disk. If
you later want to sync alias harness outputs from the current on-disk main
harness without re-specifying the plugin, use
[`harnesstap mirror`](./27-project-sync.md) instead.
