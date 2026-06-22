---
description: The atomic unit HarnessDeck scans, stores, composes, and re-emits.
---

# Resources

A **resource** is the atomic unit HarnessDeck scans, stores, composes, and re-emits. Skills, instructions, rules, MCP servers, hooks, agents, commands, and plugin pins are all resources in the canonical library.

## Context vs environment resources

HarnessDeck separates what the model sees from how it runs.

### Context-side material resources

These are scanned from project and home harness files, curated in layers, and written back during apply:

| Type | Examples on disk |
| --- | --- |
| **instructions** | `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, `.github/copilot-instructions.md` |
| **skills** | `SKILL.md` trees under harness-native skill directories |
| **rules** | `.cursor/rules/*.mdc`, `.claude/rules/`, `.kiro/steering/`, … |
| **mcp** | MCP server definitions from harness MCP config files |
| **permissions** | Allow/deny patterns (Claude Code and Codex settings) |
| **hooks** | Hook event definitions from settings or `hooks.json` |
| **agents** | Agent manifest files under harness `agents/` directories |
| **commands** | Static command definitions (markdown, TOML, or manifest pointers) |

### Layer composition attachments

On top of material resources, layers can reference:

| Attachment | Role |
| --- | --- |
| **plugin_pin** | Lazy link to a host marketplace or local plugin; materializes after `resource sync` or `layer apply --sync-plugins` |
| **layer** | Nested layer reference expanded depth-first at apply time |

### Environment resources

Environments carry *how* values that override matching layer resources during apply:

| Type | Role |
| --- | --- |
| **env_var** | Plain environment variable key/value pairs |
| **model_config** | Default model and provider selection |
| **permissions** | Runtime permission overrides |
| **secret_ref** | Indirection to secrets (exported as refs, not plaintext) |

See the full harness matrix — which types each harness supports — in [Supported harnesses](../../supported-harnesses.md). For env vars, secret refs, MCP token switching, and OAuth limits, see [Environments](./environments.md).

## Scan and import

`scan` detects supported harness files in a repository and imports them into the canonical library. `init` also scans registered platform default folders in your home directory (e.g. `~/.claude/`, `~/.codex/`).

```bash
hd init --main codex --aliases claude-code,cursor
hd scan .
hd resource list
hd resource list --search helper          # non-interactive filter
hd resource show skill:research-helper
```

`scan` automatically merges repo-root plugin trees (`.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/`) with harness project files when a recognized manifest is present.

Install skills from a remote package without a prior scan:

```bash
hd add owner/repo --skill my-skill
```

## Canonical SQLite library

Imported resources live in `~/.harnessdeck/harnessdeck.db` alongside plugins, environments, layers, tracked projects, and snapshots. The database is the single source of truth for composition — on-disk harness files are **materialized views** produced by apply, mirror, or profile use.

Key resource commands:

```bash
hd resource list [--format json]
hd resource show <selector>
hd resource sync <plugin-pin-selector> [--force]
hd resource delete <selector>
```

Use `--format json` for scripting. Interactive `resource list` opens a filter overlay; see [Interactive UX](../interactive-ux.md). Human list tables show bare names in the NAME column and plugin or package paths in NAMESPACE; compose with `name@namespace` selectors as documented in the command reference.

## From resources to layers

Resources alone are not applied to projects. You group them into plugins and layers, then apply the layer:

```bash
hd layer create my-setup
hd layer edit my-setup --add research-helper --type skill
hd layer edit my-setup --add shared-rules --type rule
hd layer apply my-setup --project . --harness claude-code,cursor
```

`layer from-project` is a shortcut that scans a repository and promotes imported resources into a new layer in one step.

## Plugin resources

Marketplace plugins import as `plugin_pin` resources. Sync resolves the plugin tree into child resources:

```bash
hd layer edit my-setup --add plugin_pin:formatter@my-marketplace --version "^2.1.0"
hd resource sync plugin_pin:formatter@my-marketplace
hd resource show plugin_pin:formatter@my-marketplace
```

Claude Code and Cursor have native plugin install/sync providers. Other harnesses may import plugin manifest metadata without full install-tree fidelity — see [Portability limits](../../portability-limits.md).

## Portability notes

Most static, file-based resources round-trip faithfully across harnesses. Some surfaces are runtime-only or host-specific (hooks with `${*_PLUGIN_ROOT}`, OpenCode server plugins, instruction-only skill emission). HarnessDeck imports metadata where possible but does not claim full fidelity for every case.

Before relying on cross-harness apply, review [Portability limits](../../portability-limits.md) and the per-harness matrix in [Supported harnesses](../../supported-harnesses.md).

## Related

- [Layers](./layers.md) — composing resources into applyable packages
- [Projects](./projects.md) — scanning and applying in a repository
- [Supported harnesses](../../supported-harnesses.md) — resource types per harness
- [Portability limits](../../portability-limits.md) — fidelity caveats
- [Command reference](../command-reference.md) — `resource` and `add` commands
- [Scenario 31](../../scenarios/details/31-dual-mode-plugin-import.md) — dual-mode plugin import
- [Scenario 35](../../scenarios/details/35-add-skill-package.md) — add skill packages
- [Environments](./environments.md) — secret refs, cascade, MCP auth limits
