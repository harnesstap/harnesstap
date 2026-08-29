# Getting started

This guide walks through install, a first catalog apply, and the follow-up scan/compose/publish loop. For every command and flag, see the [command reference](./command-reference.md). For deeper workflows, browse the [scenario guides](../scenarios/scenarios.md).

## Requirements

- **Node.js** 20 or later
- **Bun** 1.3+ (optional; required only when contributing from source)

## Install

### Recommended: npx (no global install)

```bash
npx harnesstap@latest init
```

### npm global

```bash
npm install -g harnesstap
ht init
```

### Bun (alternative)

```bash
bun install -g harnesstap
ht init
```

Or run without a global install:

```bash
bunx harnesstap@latest init
```

`ht` is shorthand for `harnesstap` throughout these docs.

## Quick start

Apply a public catalog baseline in a few minutes.

1. **Initialize** local state (creates `~/.harnesstap` and scans supported home harness folders).

   ```bash
   ht init --main codex --aliases claude-code,cursor
   ```

2. **Apply** a catalog plugin by bare name (fetches from the public HarnessTap Cloud catalog when needed).

   ```bash
   ht plugin list --search foundation --remote-only
   ht apply engineering-foundation
   ```

3. **Inspect** project state and next steps.

   ```bash
   ht status .
   ht help
   ```

When a repository has a git `origin`, `ht apply` stores a snapshot before writing files. Restore it later with `ht revert`. `ht apply` also evaluates `apm-policy.yml` when present; use `ht audit --ci` in CI for the same policy plus Unicode/hash checks.

Starter plugins such as `engineering-foundation` live in the **public cloud catalog**, not inside the npm package. To opt out of anonymous public catalog lookups, set `catalog.publicCatalog: false` in `~/.harnesstap/config.jsonc` or export `HARNESSTAP_PUBLIC_CATALOG=0`.

## Follow-up: scan, compose, and publish

After the baseline fits, build and share your own plugins.

1. **Scan** the current repository and review imports.

   ```bash
   ht scan .
   ht resource list
   ```

2. **Create** a reusable plugin and add resources.

   ```bash
   ht plugin create my-setup --description "Shared project assistant setup"
   ht plugin edit my-setup --add research-helper --type skill
   ```

3. **Apply**, mirror alias harnesses, or publish to the cloud catalog.

   ```bash
   ht apply my-setup --project . --harness claude-code,cursor
   ht mirror .
   ht auth login
   ht plugin catalog register acme/default
   ht plugin publish my-setup
   ```

4. **Manage** harness preferences after init.

   ```bash
   ht harness status --format json
   ht harness set --main claude-code --aliases cursor,codex
   ```

## Where data lives

Operational state lives in `~/.harnesstap/harnesstap.db` (resources, plugins, environments, tracked projects, snapshots). Optional settings live in `~/.harnesstap/config.jsonc`. Override the base directory with `HARNESSTAP_HOME`.

`init` seeds a `global default` profile plugin and writes `active-profile.json`, but does **not** run global apply automatically. Run `ht profile use "global default"` to materialize home harness files. See [Profiles](./concepts/profiles.md).

## Next steps

- [Command reference](./command-reference.md) — grouped CLI surface and flags
- [Concepts overview](./concepts/overview.md) — architecture and data model
- [HarnessTap Cloud](./cloud.md) — authenticate and work with shared plugins
- [Scenario guides](../scenarios/scenarios.md) — numbered playbooks (preview/apply, drift, mirror, migration, …)
