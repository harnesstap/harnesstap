# HarnessDeck — domain glossary

Terms and meanings agreed during design discussions. Implementation details belong in SPEC.md and ADRs, not here.

## People

**Primary user (phase 1)** — A solo developer or small team who already uses two or more coding agents (e.g. Codex, Cursor, Claude Code) and wants one canonical agent configuration materialized across repos and harnesses without manual duplication.

**Enterprise user (phase 2)** — A platform or developer-experience team that publishes governed agent baselines to an organization catalog for multiplayer install, review, and governance. Delivered via HarnessDeck Cloud as a paid product.

## Axes

**Context-side** — Everything that shapes *what* the model sees: instructions, skills, rules, MCP definitions, hooks, agents, commands, and dependencies that bring those in. Replaces the older term *plugin-side*. Pairs with **environment-side** (*how* the agent runs: env vars, models, permissions, secrets).

**Environment-side** — Runtime *how* configuration: env vars, model selection, permissions, secret references. Satisfies layer `needs[]` contracts; merged via the environment cascade on apply.

## Concepts

**Layer** — The primary user-facing unit of reusable agent configuration. A versioned **context package**: context-side material resources plus optional dependencies (**plugin pins**, **layer references**) and an optional default **environment**. Persona A installs, stacks, publishes, and applies *layers*.

**Deck** — Git-transport packaging for one or more layers plus optional environments (`.harnessdeck/deck.toml`). Not a peer hero noun: daily work is `layer apply`; `deck apply` is for adopting a pre-curated repo bundle.

**Resource** — A stored row in the canonical library. Two families:
- **Material resources** (context-side or environment-side atoms): `skill`, `rule`, `instruction`, `mcp_server`, `hook`, `agent`, `command`, `env_var`, `model_config`, `permission`.
- **Composition resources** (edges on a layer): `plugin_pin`, `layer`.

**Host plugin** — An installable bundle in the host harness world (Claude marketplace plugin, Cursor plugin pack, Codex plugin, etc.): manifest metadata plus a tree of skills, rules, agents, and related files. *Not* a HarnessDeck storage type by itself — it is the thing a **plugin pin** points at and `resource sync` materializes from.

**Plugin pin** — A layer dependency on a host plugin: selector `plugin_pin:ref@marketplace`, version constraint, sync status. Analogous to a dependency entry in `package.json`. After sync, the host plugin's tree appears as namespaced **material resources** in the library. There is no separate stored "plugin" aggregate row — only the pin plus exploded children (pin + exploded resources model).

**Layer reference** — A layer dependency on another HarnessDeck layer (`layer:name@^1.0`). Used for catalog/local registry deps (org/catalog/name@version). Analogous to depending on another published package.

## Naming rules (agreed)

| Term | Use for | Do not use for |
| --- | --- | --- |
| **plugin** | Host plugin (manifest + tree on disk / in marketplace) | A HarnessDeck storage row or layer attachment |
| **plugin_pin** | Composition reference attached to a layer | The host plugin bundle itself |
| **layer** | HarnessDeck versioned context package; catalog publish unit | Git-transport repo (that's a **deck**) |
| **context-side** | The *what* axis (skills, rules, …) | Runtime secrets/env (that's **environment-side**) |

No backward-compatibility requirement pre-release: rename `type=plugin` → `plugin_pin` and `plugin-side` → `context-side` throughout spec, CLI, and storage.
