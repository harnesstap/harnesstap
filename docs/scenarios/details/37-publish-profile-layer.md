# Scenario 37: Publish a profile layer to the catalog

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want teammates to discover and install a switchable global
preset from HarnessDeck Cloud. Published profiles are ordinary published
layers with the `profile` tag — there is no separate catalog entity.

Typical commands:

```bash
harnessdeck auth login work
harnessdeck profile create work --description "Work machine preset"
harnessdeck layer edit work --add layer:engineering-foundation
harnessdeck profile publish work --account work
harnessdeck profile list --search foundation --remote-only --account work
harnessdeck profile pull harnessdeck-cloud/default/work@1.0.0
harnessdeck profile use work
```

What this gives you:

- `profile publish` runs the same pipeline as `layer publish` with extra
  validation warnings (empty stack, unpublished local composition refs)
- Cloud browse can filter published layers with `tag=profile` (Profiles tab
  in HarnessDeck Cloud)
- `profile pull` installs the bundle locally and warns when the result is
  not profile-tagged
- `profile use` auto-pulls missing published `layer` dependencies before
  global apply (pass `--no-pull` to require local copies)

Profile layers export as `urn:harnessdeck:layer:v1` with `tags` including
`profile`. Share across machines with `migrate export` / `migrate import`
(active profile pointer included) or pull from the catalog after publish.

For project baselines without the profile tag, use `layer publish` and
`layer pull` directly ([Scenario 11](./11-builtin-layer.md)).
