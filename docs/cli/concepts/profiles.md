---
description: Machine-wide plugins applied to home harness paths, not repository working trees.
---

# Profiles

A **profile** is a plugin tagged `profile` that defines your machine-wide agent harness setup. Profiles apply to **home harness paths** (`~/.claude/`, `~/.codex/`, `~/.cursor/`, …) — not to repository working trees. Use `apply` for project-scoped baselines.

## Machine-wide home harness state

When you run `ht init`, HarnessTap:

1. Creates the local workspace at `~/.harnesstap`
2. Imports home harness defaults into the library and lists tracked directories (home as `~`)
3. Seeds a `default` profile plugin (tagged `profile`) from those library resources
4. Writes `~/.harnesstap/active-profile.json` pointing at that plugin

`init` sets the active profile pointer only — it does **not** run global apply. Materialize home harness files after bootstrap:

```bash
ht init --main codex --aliases claude-code,cursor
ht profile use default
# or shorthand when <name> is not a reserved command:
ht default
```

Operational state (resources, plugins, profiles, environments) lives in `~/.harnesstap/harnesstap.db`. Home environment fragments may live under `~/.harnesstap/environments/`.

## Profile commands

```bash
ht profile list
ht profile status
ht profile create work --description "Work machine stack"
ht profile use work --harness claude-code,cursor
ht profile switch work
ht profile preview work --scope both
ht profile stash
ht profile use work --dry-run
ht profile delete old-profile
```

`profile switch` applies a new profile globally and restores the previous one if apply fails. `profile preview` shows what would be written (home, project, or both) without changing disk. `profile stash` saves untracked on-disk resources for the active profile; use `profile stash pop` or `profile stash apply` to restore.

For project repos with `.harnesstap/config.toml`, use `ht use --profile <key>` (not a positional profile name).

`profile use` merges the profile plugin and transitive `plugin` refs, resolves the environment cascade, then writes global harness files.

| Command | Scope |
| --- | --- |
| `profile use` | Machine home harness paths |
| `apply --project .` | Repository working tree |

Root shorthand `ht <name>` works when `<name>` is the first non-option argument, is a profile plugin, and not a reserved command (e.g. `ht work` ≡ `ht profile use work`; `ht --no-color work` also works).

## Building a profile stack

Profiles are plugins. Compose them like any other plugin before switching:

```bash
ht plugin create work --description "Work context"
ht plugin edit work --add engineering-foundation --type plugin
ht plugin edit work --add internal-style-guide --type skill
ht profile create work    # promotes existing plugin when name already exists
ht profile use work
```

Combine multiple context plugins with `plugin edit --add plugin:…` refs. `profile use` expands nested plugin dependencies depth-first.

## Init defaults

Control bootstrap behavior with init flags:

```bash
ht init --main claude-code --aliases cursor,codex
ht init --no-default-profile    # skip default profile plugin and active-profile.json
ht init --interactive           # prompt for harness selection
```

After init, manage harness preferences independently:

```bash
ht harness status --format json
ht harness set --main claude-code --aliases cursor,codex
```

The **main** harness is the primary write target during profile apply. **Aliases** receive mirrored output when you run `mirror` in a repo, or when profile apply includes multiple harnesses via `--harness`.

## Cloud-backed profiles

Search, pull, and publish profile-tagged plugins through HarnessTap Cloud:

```bash
ht auth login
ht profile list --search react --remote-only
ht profile pull org/work-stack
ht profile publish work --org acme --catalog default
```

`profile pull` is an alias for `plugin pull` with a warning when the remote plugin is not profile-tagged. `profile publish` targets org catalogs for teammate discovery.

## When to use profiles vs projects

| Situation | Use |
| --- | --- |
| Separate work / personal / client setups on one machine | Profiles (`profile use`, `ht <name>`) |
| Repo-specific team baseline | `apply --project .` |
| Sync alias harness files from on-disk main without re-applying a plugin | `mirror` |
| Detect manual edits after apply | `status --check` |

Profiles answer "what runs on this machine by default?" Projects answer "what does this repository get?"

## Related

- [Plugins](./plugins.md) — composition, plugin pins, catalog baselines
- [Projects](./projects.md) — repo-scoped apply and mirror
- [Getting started](../getting-started.md) — init and first apply
- [Cloud connection](../cloud.md) — authenticate and publish
- [Command reference](../command-reference.md) — `profile` command group
- [Scenario 36](../../scenarios/details/36-switch-profile.md) — switch global profile presets
