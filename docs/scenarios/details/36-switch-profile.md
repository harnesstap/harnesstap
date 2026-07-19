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

- a `default` profile layer seeded at `init` (tagged `profile`) plus
  `~/.harnesstap/active-profile.json` pointing at it
- `profile use` merges the profile layer and transitive `layer` refs, then
  writes global harness files (not project directories)
- root shorthand `ht <name>` when `<name>` is a profile layer and not a
  reserved command

`init` sets the active profile pointer only — it does **not** run global
apply. Run `profile use default` (or `ht default`) after bootstrap to
materialize home harness files.

Create additional profiles with `profile create <name>` (promotes an
existing layer when the name already exists). Remove them with
`profile delete <name>`. Combine stack layers with `layer edit` before
switching.

For project-specific baselines, use `layer apply` instead
(see [Scenario 7](./07-preview-apply-layer.md) and
[Scenario 25](./25-stack-layers.md)).
