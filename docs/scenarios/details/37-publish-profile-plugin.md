# Scenario 37: Publish a profile plugin to the catalog

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want teammates to discover and install a switchable global
preset from HarnessTap Cloud. Published profiles are ordinary published
plugins with the `profile` tag — there is no separate catalog entity.

Typical commands:

```bash
harnesstap auth login work
harnesstap profile create work --description "Work machine preset"
harnesstap plugin edit work --add plugin:engineering-foundation
harnesstap profile publish work --account work
harnesstap profile list --search foundation --remote-only --account work
harnesstap profile pull harnesstap-cloud/default/work@1.0.0
harnesstap profile use work
```

What this gives you:

- `profile publish` runs the same pipeline as `plugin publish` with extra
  validation warnings (empty stack, unpublished local composition refs)
- Cloud browse can filter published plugins with `tag=profile` (Profiles tab
  in HarnessTap Cloud)
- `profile pull` installs the bundle locally and warns when the result is
  not profile-tagged
- `profile use` auto-pulls missing published `plugin` dependencies before
  global apply (pass `--no-pull` to require local copies)

Profile plugins export as `urn:harnesstap:layer:v1` (schema id still says `layer`) with `tags` including
`profile`. Share across machines with `migrate export` / `migrate import`
(active profile pointer included) or pull from the catalog after publish.

For project baselines without the profile tag, use `plugin publish` and
`plugin pull` directly ([Scenario 11](./11-builtin-plugin.md)).
