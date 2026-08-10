---
description: Versioned context packages you create, diff, export, publish, and apply.
---

# Plugins

A **plugin** is HarnessTap's versioned context package: the unit you create, diff, export, publish, and apply. Plugins compose resources, **plugin dependencies** (marketplace, local, git, or catalog), and an optional default environment.

## Plugins and plugins

| Piece | Role |
| --- | --- |
| **Resource** | Smallest unit: skill, rule, MCP server, hook, agent, command, … |
| **Plugin** | Versioned package of resources plus dependencies, with an optional default environment |
| **Plugin dependency** | Another plugin this one requires — `plugin:ref@source` with a version constraint |

Create and edit plugins locally:

```bash
ht plugin create my-setup --description "Shared project assistant setup"
ht plugin edit my-setup --add research-helper --type skill
ht plugin edit my-setup --add plugin:formatter@my-marketplace --version "^2.1.0"
ht plugin edit team-stack --add plugin:shared-baseline --version "^1.2.0"
ht plugin show my-setup
```

`plugin doctor` checks for duplicate resources, empty content, or invalid plugin metadata. `plugin diff` compares plugin metadata and contents against another plugin or a TOML bundle. `plugin from-project` scans a repository and turns imported resources into a new plugin.

## Provenance (origin)

Every local plugin row has an **origin**. Capabilities vary by origin; `ht plugin list` shows an Origin column (JSON includes `origin`), and refusal errors name the fix instead of only failing.

| Origin | How it gets there | edit / cut / publish / add needs | sync |
| --- | --- | --- | --- |
| `authored` | `plugin create`, `plugin from-project`, `plugin fork`, conflict scaffolding | Yes | No |
| `upstream` | Materialized from a marketplace, local path, or git plugin install tree | No — error names `fork` | Yes |
| `catalog` | `plugin pull` from an org catalog | No — error names `fork` | Yes |

Upstream and catalog plugins are read-only graph nodes until you fork them:

```bash
ht plugin fork web-search
ht plugin fork web-search --as my-web-search
ht plugin edit my-web-search
```

`plugin fork` copies an upstream or catalog plugin into a new **authored** plugin (default name `<name>-fork`). The source row is left untouched; resource rows are shared until you attach or detach differently.

## Plugin dependencies

Plugin pins and nested plugin refs are one type: a **plugin** attachment with provenance metadata. Add dependencies with `plugin:ref@source` (or a bare local name):

| `source_kind` | Ref shape | Resolves to |
| --- | --- | --- |
| `local` | `base`, `./relative/path` | A plugin row in the local library |
| `marketplace` | `web-search@anthropics` | An `upstream` plugin materialized from the install tree |
| `git` | `https://…`, `git@…` | An `upstream` plugin materialized from the clone |
| `catalog` | `acme/default/base` | A `catalog` plugin pulled from the cloud |

```bash
ht plugin edit my-setup --add plugin:formatter@my-marketplace --version "^2.1.0"
ht plugin edit my-setup --add plugin:shared-baseline --version "^1.2.0"
ht plugin edit my-setup --add plugin:https://github.com/acme/plugin.git --version "^1.0.0"
ht plugin edit my-setup --add plugin:acme/default/base --version "^2.0.0"
```

Legacy selectors `plugin_pin:…` and `plugin:…` still resolve and print a notice naming the new `plugin:` spelling.

## Composition and resolution

Plugins depend on other plugins. `ht apply` does not walk an ordered stack — it resolves the whole dependency graph, then materializes one coherent set of resources.

**Pass 1 — one version per plugin name.** Every constraint on a name is collected and intersected. The selected version is the highest available version that satisfies every constraint. A version or override declared by the plugin you applied ends mediation for that name. An empty intersection is a hard error that names both requirers and their dependency paths.

**Pass 2 — one resource per `type:name`.** Resources from the resolved set are flattened with each resource's depth (the root's own resources are depth 0):

| Case | Outcome |
| --- | --- |
| Distinct `type:name` | Both materialize |
| Same `type:name`, different depth | Nearest to root wins (silent; recorded in the explain trail) |
| Same `type:name`, same depth, identical content | No-op |
| Same `type:name`, same depth, differing content, set-like types (`skill`, `rule`, `agent`, `command`, `hook`, `mcp_server`) | Last-declared wins with a warning |
| Same `type:name`, same depth, differing content, singleton types (`instruction`, `model_config`, `permission`, `env_var`) | Error — fix with an override |

Merge semantics are replace-only: the winner replaces the resource whole.

```bash
ht apply my-setup --project .
ht apply team-base team-overrides   # ephemeral root with both as dependencies
```

### Lockfile

Successful project applies write `.harnesstap/lock.toml`. Check it in. It records the resolved plugin name → version set (plus integrity metadata) so re-applies reuse the same resolution until you ask otherwise:

```bash
ht apply my-setup            # reuse lock when consistent with the manifest
ht apply my-setup --update   # ignore the lock and re-resolve
```

`ht status --check` reports lock drift (manifest and lock disagree) alongside ordinary project drift.

### Inspecting decisions

```bash
ht apply my-setup --explain
ht plugin why base
ht plugin why skill:deploy
```

`--explain` prints the resolution trail: selected versions with the constraints that produced them, and every contested resource with winner, loser, and reason. `plugin why` answers the same questions against the lockfile (or `--root` when you want a fresh resolve).

## Plugin dependencies and version policy

Marketplace and other upstream dependencies attach like any other composition item. Sync refreshes **upstream** or **catalog** plugins only — authored plugins have nothing to sync from.

```bash
ht plugin edit my-setup --add plugin:formatter@my-marketplace --version "^2.1.0"
ht plugin edit my-setup --add plugin:formatter@my-marketplace --sync   # eager sync after add
ht resource sync plugin:formatter@my-marketplace
ht apply my-setup --project . --strict-plugin-versions
```

On `apply`, HarnessTap compares dependency version constraints to library `resolved_version` values:

- **Default** — warn on mismatch
- `--strict-plugin-versions` — fail with exit code 2
- `--ignore-plugin-versions` — skip validation
- `--sync-plugins` — refresh upstream plugin resources before materialize

Plugin install and sync providers exist for **Claude Code** and **Cursor**. Plugin-source scan covers `.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, and `.github/plugin/` layouts.

Refresh policy for marketplace metadata is configured in `~/.harnesstap/config.jsonc`:

```jsonc
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

`resource sync` uses cached metadata unless it is stale; pass `--force` to refresh regardless.

## Version cuts and dirty heads

Each plugin name has a **working head** — the latest editable version. Edits after a cut (for example `plugin edit --add`) mark the head **dirty** without changing its semver. Dirty heads are shown with a trailing `*` in human output (`plugin list`, `plugin show`) — for example `1.2.0*` — while JSON output keeps the real `version` string and a separate `dirty` flag.

Cut a new semver to freeze the current composition and advance the head:

```bash
ht plugin cut my-setup --version 1.3.0
```

The previous head is frozen in place (copy-on-write); the new head starts clean at the requested version. Frozen versions cannot be edited or cut again.

HarnessTap keeps at most `pluginVersionHistoryLimit` versions per plugin name (head included). Oldest frozen versions are pruned on cut when over the limit. Configure in `~/.harnesstap/config.jsonc` (default `10`):

```jsonc
{
  "pluginVersionHistoryLimit": 10
}
```

**Sharing rules:** export, `migrate export --plugin`, and `plugin publish` refuse dirty heads so bundles and catalog uploads always reflect a cut version. `edit`, `cut`, `publish`, and adding `needs` also require an **authored** origin — fork upstream or catalog plugins first. Cut first, or pass `--version <semver>` on `plugin publish` to cut and publish in one step:

```bash
ht plugin publish my-setup --version 1.3.0 --account acme
```

## Environment cascade

Environments carry *how* values (env vars, model config, permissions, secret refs). During apply, values resolve through a cascade — **last wins**:

```
home active environment ◂ plugin default environment
```

Switch the home active environment to change runtime values without rebuilding the plugin stack. Bind a default environment to a plugin with `plugin edit --environment <name>`.

## Catalog baselines

Starter plugins such as `engineering-foundation` and `frontend-engineer` live in the **HarnessTap Cloud public catalog**, not inside the npm package.

```bash
ht plugin list --search foundation --remote-only
ht apply engineering-foundation
```

`ht apply <name>` resolves bare names against the public catalog (and any orgs or libraries you have connected). Use `plugin pull` to cache a bundle locally for offline work.

To opt out of anonymous public catalog lookups:

```jsonc
// ~/.harnesstap/config.jsonc
{ "catalog": { "publicCatalog": false } }
```

Or export `HARNESSTAP_PUBLIC_CATALOG=0`.

Connect additional org catalogs explicitly:

```bash
ht auth login
ht plugin catalog connect <org>/<library>
ht plugin pull org/plugin-name
```

Register publish destinations before uploading:

```bash
ht plugin catalog register acme/default
ht plugin publish my-setup
```

## Offline sharing

Plugins move between machines as **plugin v1** TOML bundles (`urn:harnesstap:layer:v1`; schema id deliberately keeps `layer`):

```bash
ht migrate export ./my-setup.harnesstap.toml --plugin my-setup
ht migrate import ./my-setup.harnesstap.toml
ht migrate export ./team.harnesstap.toml --plugin my-setup --embed-plugins
```

Default export path: `<name>.harnesstap.toml`. Bundles include one or more `[[plugins]]` entries, optional plugin dependencies, and optional root `embedded_plugins` when plugin trees are inlined. `dependencies` is included when a plugin declares versioned semver constraints.

For a full workspace handoff (plugins, environments, harness preferences, config), use `ht migrate export` with a `.tar.gz` archive — see [Scenario 28](../../scenarios/details/28-machine-migration.md).

For multiplayer distribution, use `plugin publish` / `plugin pull` via HarnessTap Cloud. See [Cloud connection](../cloud.md).

## Deprecated `ht layer` alias

`ht layer …` remains a hidden alias for `ht plugin …` for one release and prints a rename notice. Prefer `ht plugin` and top-level `ht apply`.

## Plugin workflows at a glance

| Task | Command |
| --- | --- |
| Create from scratch | `plugin create` |
| Add resources or deps | `plugin edit --add` / `--remove` |
| Fork upstream / catalog | `plugin fork` |
| Diagnose before apply | `plugin doctor` |
| Explain a resolve decision | `plugin why` / `apply --explain` |
| Compare versions | `plugin diff` |
| Cut a new semver | `plugin cut --version` |
| Infer from a repo | `plugin from-project` |
| Apply to a project | `apply` / `apply --update` |
| Check lock drift | `status --check` |
| Apply to home harness | `profile use` (profile-tagged plugins) |
| Export / import TOML | `migrate export --plugin` / `migrate import` |
| Publish / pull cloud | `plugin publish` / `plugin pull` |

## Related

- [Resources](./resources.md) — what plugins are made of
- [Profiles](./profiles.md) — machine-wide apply
- [Projects](./projects.md) — repo-scoped apply
- [Command reference](../command-reference.md) — `plugin` command group
- [Scenario 7](../../scenarios/details/07-preview-apply-plugin.md) — preview and apply
- [Scenario 25](../../scenarios/details/25-stack-plugins.md) — stack multiple plugins
