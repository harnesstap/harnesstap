---
description: Versioned context packages you create, diff, export, publish, and apply.
---

# Layers

A **layer** is HarnessDeck's versioned context package: the unit you create, diff, export, publish, and apply. Layers compose plugins, plugin pins, nested layer refs, and an optional default environment.

## Layers and plugins

| Piece | Role |
| --- | --- |
| **Plugin** | Groups *what* resources (skills, rules, MCP, hooks, …) plus host-specific config |
| **Layer** | One or more plugins (and attachments) with an optional default environment |
| **Plugin pin** | Lazy link to a host marketplace plugin (`plugin_pin:name@marketplace`); resolved at sync or apply |
| **Layer ref** | Nested layer dependency expanded depth-first at apply time |

Create and edit layers locally:

```bash
hd layer create my-setup --description "Shared project assistant setup"
hd layer edit my-setup --add research-helper --type skill
hd layer edit my-setup --add plugin_pin:formatter@my-marketplace --version "^2.1.0"
hd layer edit team-stack --add layer:shared-baseline --version "^1.2.0"
hd layer show my-setup
```

`layer doctor` checks for duplicate resources, empty content, or invalid plugin metadata. `layer diff` compares layer metadata and contents against another layer or a TOML bundle. `layer from-project` scans a repository and turns imported resources into a new layer.

## Plugin pins and version policy

Plugin pins attach to a layer like any other composition item:

```bash
hd layer edit my-setup --add plugin_pin:formatter@my-marketplace --version "^2.1.0"
hd layer edit my-setup --add plugin_pin:formatter@my-marketplace --sync   # eager sync after add
hd resource sync plugin_pin:formatter@my-marketplace
hd layer apply my-setup --project . --strict-plugin-versions
```

On `layer apply`, HarnessDeck compares layer plugin pins to library `resolved_version` values:

- **Default** — warn on mismatch
- `--strict-plugin-versions` — fail with exit code 2
- `--ignore-plugin-versions` — skip validation
- `--sync-plugins` — refresh plugin resources before materialize

Plugin install and sync providers exist for **Claude Code** and **Cursor**. Plugin-source scan covers `.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, and `.github/plugin/` layouts.

Refresh policy for marketplace metadata is configured in `~/.harnessdeck/config.jsonc`:

```jsonc
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

`resource sync` uses cached metadata unless it is stale; pass `--force` to refresh regardless.

## Environment cascade

Environments carry *how* values (env vars, model config, permissions, secret refs). During apply, values resolve through a cascade — **last wins**:

```
home active environment ◂ layer default environment
```

Switch the home active environment to change runtime values without rebuilding the layer stack. Bind a default environment to a layer with `layer edit --environment <name>`.

## Catalog baselines

Starter layers such as `engineering-foundation` and `frontend-engineer` live in the **HarnessDeck Cloud public catalog**, not inside the npm package.

```bash
hd layer search foundation
hd layer apply engineering-foundation
```

`hd layer apply <name>` resolves bare names against the public catalog (and any orgs or libraries you have connected). Use `layer pull` to cache a bundle locally for offline work.

To opt out of anonymous public catalog lookups:

```jsonc
// ~/.harnessdeck/config.jsonc
{ "catalog": { "publicCatalog": false } }
```

Or export `HARNESSDECK_PUBLIC_CATALOG=0`.

Connect additional org catalogs explicitly:

```bash
hd auth login
hd layer catalog connect <org>/<library>
hd layer pull org/layer-name
```

Register publish destinations before uploading:

```bash
hd layer catalog register acme/default
hd layer publish my-setup
```

## Offline sharing

Layers move between machines as **layer v1** TOML bundles (`urn:harnessdeck:layer:v1`):

```bash
hd migrate export ./my-setup.harnessdeck.toml --layer my-setup
hd migrate import ./my-setup.harnessdeck.toml
hd migrate export ./team.harnessdeck.toml --layer my-setup --embed-plugins
```

Default export path: `<name>.harnessdeck.toml`. Bundles include one or more `[[layers]]` entries, optional `plugin_pins`, and optional root `embedded_plugins` when plugin trees are inlined. `dependencies` is included when a layer declares versioned semver constraints.

For a full workspace handoff (layers, environments, harness preferences, config), use `hd migrate export` with a `.tar.gz` archive — see [Scenario 28](../../scenarios/details/28-machine-migration.md).

For multiplayer distribution, use `layer publish` / `layer pull` via HarnessDeck Cloud. See [Cloud connection](../cloud.md).

## Layer workflows at a glance

| Task | Command |
| --- | --- |
| Create from scratch | `layer create` |
| Add resources or deps | `layer edit --add` / `--remove` |
| Diagnose before apply | `layer doctor` |
| Compare versions | `layer diff` |
| Infer from a repo | `layer from-project` |
| Apply to a project | `layer apply` |
| Apply to home harness | `profile use` (profile-tagged layers) |
| Export / import TOML | `migrate export --layer` / `migrate import` |
| Publish / pull cloud | `layer publish` / `layer pull` |

## Related

- [Resources](./resources.md) — what layers are made of
- [Profiles](./profiles.md) — machine-wide layer apply
- [Projects](./projects.md) — repo-scoped layer apply
- [Command reference](../command-reference.md) — `layer` command group
- [Scenario 7](../../scenarios/details/07-preview-apply-layer.md) — preview and apply
- [Scenario 25](../../scenarios/details/25-stack-layers.md) — stack multiple layers
