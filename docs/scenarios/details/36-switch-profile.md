# Scenario 36: Switch global profile presets

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you maintain separate agent setups for work, personal, or
client contexts and want one command to apply the right stack to your
**machine home** harness files (`~/.claude/`, `~/.codex/`, …).

Typical commands:

```bash
harnessdeck init
harnessdeck profile list
harnessdeck profile use default --dry-run
harnessdeck profile use work --harness claude-code,cursor
harnessdeck profile active
hd work
```

What this gives you:

- a `default` profile layer seeded at `init` (tagged `profile`) plus
  `~/.harnessdeck/active-profile.json` pointing at it
- `profile use` merges the profile layer and transitive `layer` refs, then
  writes global harness files (not project directories)
- root shorthand `hd <name>` when `<name>` is a profile layer and not a
  reserved command

`init` sets the active profile pointer only — it does **not** run global
apply. Run `profile use default` (or `hd default`) after bootstrap to
materialize home harness files.

Create additional profiles with `profile create <name>` or tag an existing
layer with `profile tag <layer>`. Combine stack layers with
`layer combine` before switching.

For project-specific baselines, use `layer apply` or `deck apply` instead
(see [Scenario 7](./07-preview-apply-layer.md) and
[Scenario 29](./29-apply-deck.md)).
