# Scenario 40: Use project profile config

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a repository ships `.harnesstap/config.toml` with named profiles
so teammates can switch stacks without remembering layer selectors.

Create the file with `ht config init` (from local profile layers) or copy a team template. See [Project config](../../cli/concepts/projects.md) for the `urn:harnesstap:project:v1` schema.

## Inspect the config

```bash
ht config show
ht config validate
ht use --list
```

`config validate` checks that inline profiles reference layers defined in the
same file and that default profile/environment keys resolve.

## Switch profiles

```bash
ht use --profile dev
ht use --profile prod --dry-run
ht use                        # interactive picker when multiple profiles exist
```

`ht use` resolves the profile source (local layer, catalog selector, or inline
layer table), applies the profile to home harness paths, and optionally switches
the active environment.

For machine-wide presets outside a repo, use `profile use` instead
([Scenario 36](./36-switch-profile.md)). For repo baselines without project
config, use `layer apply` ([Scenario 7](./07-preview-apply-layer.md)).
