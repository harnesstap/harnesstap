---
description: Architecture and the HarnessTap data model.
---

# Concepts overview

HarnessTap keeps assistant configuration in one place while materializing platform-specific files for Claude Code, Codex, Cursor, and dozens of other agent harnesses.

## Architecture

Configuration flows from sources (home defaults, existing project files, cloud plugins, public catalog baselines) into a local SQLite library, then out to target harnesses on disk.

```mermaid
flowchart TB
  subgraph Sources[Configuration sources]
    Home[Home defaults]
    Repo[Existing project files]
    Cloud[HarnessTap Cloud plugins]
    BuiltIn[Public catalog baselines]
  end

  subgraph Library[Local HarnessTap library]
    Resources[Canonical resources in SQLite]
    Plugins[Plugins — the what]
    Envs[Environments — the how]
    Plugins[Configured plugins]
    Bundles[Plugin v1 TOML]
  end

  subgraph Targets[Materialized harnesses]
    Claude[Claude Code]
    Codex[Codex]
    Cursor[Cursor]
    Generic[Copilot, Windsurf, Warp, OpenCode, Roo, Continue, Gemini CLI]
  end

  Home --> Resources
  Repo --> Resources
  Cloud --> Plugins
  BuiltIn --> Plugins
  Resources --> Plugins
  Plugins --> Plugins
  Envs --> Plugins
  Plugins --> Bundles
  Plugins --> Claude
  Plugins --> Codex
  Plugins --> Cursor
  Plugins --> Generic
```

A typical session looks like this:

```mermaid
sequenceDiagram
  participant User
  participant CLI as ht CLI
  participant DB as Local SQLite library
  participant Project as Target project

  User->>CLI: ht scan .
  CLI->>Project: Detect supported harness files
  CLI->>DB: Import resources canonically
  User->>CLI: ht plugin create / edit
  CLI->>DB: Save reusable plugin
  User->>CLI: ht apply plugin --harness ...
  CLI->>Project: Snapshot tracked files
  CLI->>Project: Write platform-specific configuration
  User->>CLI: ht status / drift / revert
  CLI->>Project: Compare or restore snapshots
```

## Concept model

HarnessTap separates **context-side** configuration (skills, MCP, hooks, rules — what the model sees) from **environment-side** configuration (secrets, env vars, models — how it runs).

| Concept | Role |
| --- | --- |
| **Resource** | Atomic instruction, skill, rule, MCP server, hook, agent, command, etc. |
| **Plugin** | Bundle of *what* resources plus Claude config and a `needs` contract |
| **Environment** | Named *how* values (and secret refs) — prod, staging, personal |
| **Plugin** | One or more plugins plus an optional default environment |
| **Workspace** | Local library of plugins, resources, and environments at `~/.harnesstap` |

A **plugin** is the versioned context package you apply to projects or profiles. **Plugin pins** and nested **plugin** refs are dependencies attached during composition.

**Cascade (last wins):** `home env ◂ plugin default env`. Switch the home active environment to change how-values without reloading the same plugin stack.

```mermaid
flowchart LR
  A[Init local toolkit state] --> B[Scan repo and home defaults]
  B --> C[Store canonical resources]
  C --> D[Plugins and environments]
  D --> E[Configured plugins]
  E --> F[Apply with environment cascade]
```

## Two apply surfaces

HarnessTap materializes configuration in two places:

| Surface | Scope | Primary commands |
| --- | --- | --- |
| **Profiles** | Machine-wide home harness paths (`~/.claude/`, `~/.codex/`, …) | `profile use`, `ht <profile-name>` |
| **Projects** | Repository working tree | `apply`, `mirror`, `status --check` |

Profiles answer "what stack runs on this machine by default?" Projects answer "what baseline does this repo get?" See [Profiles](./profiles.md) and [Projects](./projects.md).

## Where to go next

| Topic | Page |
| --- | --- |
| Plugins, plugins, pins, catalog | [Plugins](./plugins.md) |
| Scan, import, canonical library | [Resources](./resources.md) |
| Machine-wide home harness state | [Profiles](./profiles.md) |
| Env vars, secret refs, MCP auth limits | [Environments](./environments.md) |
| Repo apply, mirror, drift, snapshots | [Projects](./projects.md) |
| Harness matrix and resource types | [Supported harnesses](../../supported-harnesses.md) |
| Cross-harness fidelity caveats | [Portability limits](../../portability-limits.md) |
| Full CLI surface | [Command reference](../command-reference.md) |

Full specification: [SPEC.md](https://github.com/harnesstap/harnesstap/blob/main/SPEC.md) in the HarnessTap repository.
