# Getting started

This guide walks through install, a first catalog apply, and the follow-up scan/compose/publish loop. For every command and flag, see the [command reference](./command-reference.md). For deeper workflows, browse the [scenario guides](../scenarios/scenarios.md).

## Requirements

- **Node.js** 20 or later
- **Bun** 1.3+ (optional; required only when contributing from source)

## Install

### Recommended: npx (no global install)

```bash
npx harnessdeck@latest init
```

### npm global

```bash
npm install -g harnessdeck
hd init
```

### Bun (alternative)

```bash
bun install -g harnessdeck
hd init
```

Or run without a global install:

```bash
bunx harnessdeck@latest init
```

`hd` is shorthand for `harnessdeck` throughout these docs.

## Quick start

Apply a public catalog baseline in a few minutes.

1. **Initialize** local state (creates `~/.harnessdeck` and scans supported home harness folders).

   ```bash
   hd init --main codex --aliases claude-code,cursor
   ```

2. **Apply** a catalog layer by bare name (fetches from the public HarnessDeck Cloud catalog when needed).

   ```bash
   hd layer search foundation
   hd layer apply engineering-foundation
   ```

3. **Inspect** project state and next steps.

   ```bash
   hd project status .
   hd help
   ```

When a repository has a git `origin`, `hd layer apply` stores a snapshot before writing files. Restore it later with `hd project revert`.

Starter layers such as `engineering-foundation` live in the **public cloud catalog**, not inside the npm package. To opt out of anonymous public catalog lookups, set `catalog.publicCatalog: false` in `~/.harnessdeck/config.jsonc` or export `HARNESSDECK_PUBLIC_CATALOG=0`.

## Follow-up: scan, compose, and publish

After the baseline fits, build and share your own layers.

1. **Scan** the current repository and review imports.

   ```bash
   hd project scan .
   hd resource list
   ```

2. **Create** a reusable layer and add resources.

   ```bash
   hd layer create my-setup --description "Shared project assistant setup"
   hd layer edit my-setup --add research-helper --type skill
   ```

3. **Apply**, mirror alias harnesses, or publish to the cloud catalog.

   ```bash
   hd layer apply my-setup --project . --harness claude-code,cursor
   hd project mirror .
   hd auth login
   hd layer catalog register acme/default
   hd layer publish my-setup
   ```

4. **Manage** harness preferences after init.

   ```bash
   hd harness status --format json
   hd harness set --main claude-code --aliases cursor,codex
   ```

## Where data lives

Operational state lives in `~/.harnessdeck/harnessdeck.db` (resources, layers, environments, tracked projects, snapshots). Optional settings live in `~/.harnessdeck/config.jsonc`. Override the base directory with `HARNESSDECK_HOME`.

`init` seeds a `default` profile layer and writes `active-profile.json`, but does **not** run global apply automatically. Run `hd profile use default` to materialize home harness files. See [Profiles](./concepts/profiles.md).

## Next steps

- [Command reference](./command-reference.md) — grouped CLI surface and flags
- [Concepts overview](./concepts/overview.md) — architecture and data model
- [HarnessDeck Cloud](./cloud.md) — authenticate and work with shared layers
- [Scenario guides](../scenarios/scenarios.md) — numbered playbooks (preview/apply, drift, mirror, migration, …)
