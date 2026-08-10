# HarnessTap — domain glossary

Terms and meanings agreed during design discussions. Implementation details belong in SPEC.md and ADRs, not here.

## People

**Primary user (phase 1)** — A solo developer or small team who already uses two or more coding agents (e.g. Codex, Cursor, Claude Code) and wants one canonical agent configuration materialized across repos and harnesses without manual duplication.

**Enterprise user (phase 2)** — A platform or developer-experience team that publishes governed agent baselines to an organization catalog for multiplayer install, review, and governance. Delivered via HarnessTap Cloud as a paid product.

## Axes

**Context-side** — Everything that shapes *what* the model sees: instructions, skills, rules, MCP definitions, hooks, agents, commands, and dependencies that bring those in. Replaces the older term *plugin-side*. Pairs with **environment-side** (*how* the agent runs: env vars, models, permissions, secrets).

**Environment-side** — Runtime *how* configuration: env vars, model selection, permissions, secret references. Satisfies plugin `needs[]` contracts; merged via the environment cascade on apply.

## Concepts

**Plugin** — A reusable, versioned package of resources plus dependencies. The unit you author, apply, publish, and depend on. Dependencies may come from a marketplace, local path, git, or org catalog. Publish to a catalog or share via export; edit membership and apply with `ht apply` (project default) or `ht apply --global`.

**Profile** — A plugin tagged `profile`; presented as a switchable global preset. Not a separate storage type — profiles are plugins with the reserved tag `profile`. Switch with `profile use` (or root shorthand `ht <name>`); applies to machine home harness paths only.

**Workspace** — The single implicit local library in `~/.harnesstap/harnesstap.db`: all plugins, resources, and environments live here. Share offline with `migrate export` / `migrate import` (`--workspace`, `--plugin`, or `--resource`).

**Catalog** — Org-scoped published plugins for multiplayer discovery, search, and install (`ht plugin search`, `ht plugin pull`). Users cherry-pick catalog plugins into their local workspace or profile stack.

**Account** — Local HarnessTap Cloud login identity (tokens, org context) stored in `cloud-accounts.json`. Distinct from a **profile** plugin (global agent preset).

**Resource** — A stored row in the canonical library. Material atoms on the context-side or environment-side: `skill`, `rule`, `instruction`, `mcp_server`, `hook`, `agent`, `command`, `env_var`, `model_config`, `permission`.

**Dependency** — A plugin required by another plugin, from a marketplace, local path, git, or catalog. Provenance is a first-class dimension (`authored`, `upstream`, `catalog`), not a separate storage type.

**Marketplace** — Third-party source of plugins (Claude marketplace, Cursor packs, etc.).

## Naming rules (agreed)

| Term | Use for | Do not use for |
| --- | --- | --- |
| **plugin** | HarnessTap versioned package of resources + deps; catalog publish unit | Global preset alone (that's a **profile**) |
| **dependency** | A required plugin from marketplace, path, git, or catalog | The resources inside a plugin |
| **profile** | Tagged plugin (`tags` includes `profile`); global switch UX | Cloud login identity (that's an **account**) |
| **workspace** | Single local SQLite library (`~/.harnesstap`); offline share via `migrate` | Org-published multiplayer baseline (that's **catalog**) |
| **catalog** | Org-scoped published plugins; browse/search/pull | Personal plugin collection (that's the **workspace**) |
| **account** | HarnessTap Cloud auth identity (`cloud-accounts.json`, `--account`) | Profile plugin or `active-profile.json` pointer |
| **context-side** | The *what* axis (skills, rules, …) | Runtime secrets/env (that's **environment-side**) |

`layer` and `plugin_pin` leave the vocabulary; everything composable is a **plugin**. `ht layer …` remains a hidden alias for one release.

## Consolidated modules (2026-08)

- `plugin-model` — plugin CRUD and resource attachments
- `plugin-resolver` — dependency graph resolution and lockfile
- `plugin-export`, `plugin-import` — transport round-trips
- Schema v27 — `plugins` / `plugin_resources` tables (migrated from `layers` / `layer_resources`)
