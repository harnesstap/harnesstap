# Scenario 36: Switch global profile presets

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you maintain separate agent setups for work, personal, or
client contexts and want one command to apply the right stack to your
**machine home** harness files (`~/.claude/`, `~/.codex/`, …).

Typical commands:

```bash
harnesstap init
harnesstap profile list
harnesstap profile use default --dry-run
harnesstap profile use work --harness claude-code,cursor
harnesstap profile status
ht work
```

What this gives you:

- a `default` profile plugin seeded at `init` (tagged `profile`) plus
  `~/.harnesstap/active-profile.json` pointing at it
- `profile use` merges the profile plugin and transitive `plugin` refs, then
  writes global harness files (not project directories)
- root shorthand `ht <name>` when `<name>` is a profile plugin and not a
  reserved command

`init` sets the active profile pointer only — it does **not** run global
apply. Run `profile use default` (or `ht default`) after bootstrap to
materialize home harness files.

Create additional profiles with `profile create <name>` (promotes an
existing plugin when the name already exists). Remove them with
`profile delete <name>`. Combine stack plugins with `plugin edit` before
switching.

For project-specific baselines, use `apply` instead
(see [Scenario 7](./07-preview-apply-plugin.md) and
[Scenario 25](./25-stack-plugins.md)).
