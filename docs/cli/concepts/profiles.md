---
description: Machine-wide layers applied to home harness paths, not repository working trees.
---

# Profiles

A **profile** is a layer tagged `profile` that defines your machine-wide agent harness setup. Profiles apply to **home harness paths** (`~/.claude/`, `~/.codex/`, `~/.cursor/`, …) — not to repository working trees. Use `layer apply` for project-scoped baselines.

## Machine-wide home harness state

When you run `hd init`, HarnessDeck:

1. Creates the local workspace at `~/.harnessdeck`
2. Seeds a `default` profile layer (tagged `profile`)
3. Writes `~/.harnessdeck/active-profile.json` pointing at that layer

`init` sets the active profile pointer only — it does **not** run global apply. Materialize home harness files after bootstrap:

```bash
hd init --main codex --aliases claude-code,cursor
hd profile use default
# or shorthand when <name> is not a reserved command:
hd default
```

Operational state (resources, layers, profiles, environments) lives in `~/.harnessdeck/harnessdeck.db`. Home environment fragments may live under `~/.harnessdeck/environments/`.

## Profile commands

```bash
hd profile list
hd profile status
hd profile create work --description "Work machine stack"
hd profile use work --harness claude-code,cursor
hd profile use work --dry-run
hd profile delete old-profile
```

`profile use` merges the profile layer and transitive `layer` refs, resolves the environment cascade, then writes global harness files.

| Command | Scope |
| --- | --- |
| `profile use` | Machine home harness paths |
| `layer apply --project .` | Repository working tree |

Root shorthand `hd <name>` works when `<name>` is a profile layer and not a reserved command (e.g. `hd work` ≡ `hd profile use work`).

## Building a profile stack

Profiles are layers. Compose them like any other layer before switching:

```bash
hd layer create work --description "Work context"
hd layer edit work --add engineering-foundation --type layer
hd layer edit work --add internal-style-guide --type skill
hd profile create work    # promotes existing layer when name already exists
hd profile use work
```

Combine multiple context layers with `layer edit --add layer:…` refs. `profile use` expands nested layer dependencies depth-first.

## Init defaults

Control bootstrap behavior with init flags:

```bash
hd init --main claude-code --aliases cursor,codex
hd init --no-default-profile    # skip default profile layer and active-profile.json
hd init --interactive           # prompt for harness selection
```

After init, manage harness preferences independently:

```bash
hd harness status --format json
hd harness set --main claude-code --aliases cursor,codex
```

The **main** harness is the primary write target during profile apply. **Aliases** receive mirrored output when you run `mirror` in a repo, or when profile apply includes multiple harnesses via `--harness`.

## Cloud-backed profiles

Search, pull, and publish profile-tagged layers through HarnessDeck Cloud:

```bash
hd auth login
hd profile search react
hd profile pull org/work-stack
hd profile publish work --org acme --catalog default
```

`profile pull` is an alias for `layer pull` with a warning when the remote layer is not profile-tagged. `profile publish` targets org catalogs for teammate discovery.

## When to use profiles vs projects

| Situation | Use |
| --- | --- |
| Separate work / personal / client setups on one machine | Profiles (`profile use`, `hd <name>`) |
| Repo-specific team baseline | `layer apply --project .` |
| Sync alias harness files from on-disk main without re-applying a layer | `mirror` |
| Detect manual edits after apply | `status --check` |

Profiles answer "what runs on this machine by default?" Projects answer "what does this repository get?"

## Related

- [Layers](./layers.md) — composition, plugin pins, catalog baselines
- [Projects](./projects.md) — repo-scoped apply and mirror
- [Getting started](../getting-started.md) — init and first apply
- [Cloud connection](../cloud.md) — authenticate and publish
- [Command reference](../command-reference.md) — `profile` command group
- [Scenario 36](../../scenarios/details/36-switch-profile.md) — switch global profile presets
