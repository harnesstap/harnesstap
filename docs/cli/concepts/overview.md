---
description: Architecture and the HarnessDeck data model.
---

# Concepts overview

HarnessDeck keeps assistant configuration in one place while materializing platform-specific files for Claude Code, Codex, Cursor, and dozens of other agent harnesses.

## Architecture

Configuration flows from sources (home defaults, existing project files, cloud layers, public catalog baselines) into a local SQLite library, then out to target harnesses on disk.

```mermaid
flowchart TB
  subgraph Sources[Configuration sources]
    Home[Home defaults]
    Repo[Existing project files]
    Cloud[HarnessDeck Cloud layers]
    BuiltIn[Public catalog baselines]
  end

  subgraph Library[Local HarnessDeck library]
    Resources[Canonical resources in SQLite]
    Plugins[Plugins — the what]
    Envs[Environments — the how]
    Layers[Configured layers]
    Bundles[Layer v1 TOML]
  end

  subgraph Targets[Materialized harnesses]
    Claude[Claude Code]
    Codex[Codex]
    Cursor[Cursor]
    Generic[Copilot, Windsurf, Warp, OpenCode, Roo, Continue, Gemini CLI]
  end

  Home --> Resources
  Repo --> Resources
  Cloud --> Layers
  BuiltIn --> Plugins
  Resources --> Plugins
  Plugins --> Layers
  Envs --> Layers
  Layers --> Bundles
  Layers --> Claude
  Layers --> Codex
  Layers --> Cursor
  Layers --> Generic
```

A typical session looks like this:

```mermaid
sequenceDiagram
  participant User
  participant CLI as hd CLI
  participant DB as Local SQLite library
  participant Project as Target project

  User->>CLI: hd project scan .
  CLI->>Project: Detect supported harness files
  CLI->>DB: Import resources canonically
  User->>CLI: hd layer create / edit
  CLI->>DB: Save reusable layer
  User->>CLI: hd layer apply layer --harness ...
  CLI->>Project: Snapshot tracked files
  CLI->>Project: Write platform-specific configuration
  User->>CLI: hd project status / drift / revert
  CLI->>Project: Compare or restore snapshots
```

## Concept model

HarnessDeck separates **context-side** configuration (skills, MCP, hooks, rules — what the model sees) from **environment-side** configuration (secrets, env vars, models — how it runs).

| Concept | Role |
| --- | --- |
| **Resource** | Atomic instruction, skill, rule, MCP server, hook, agent, command, etc. |
| **Plugin** | Bundle of *what* resources plus Claude config and a `needs` contract |
| **Environment** | Named *how* values (and secret refs) — prod, staging, personal |
| **Layer** | One or more plugins plus an optional default environment |
| **Workspace** | Local library of layers, resources, and environments at `~/.harnessdeck` |

A **layer** is the versioned context package you apply to projects or profiles. **Plugin pins** and nested **layer** refs are dependencies attached during composition.

**Cascade (last wins):** `home env ◂ layer default env`. Switch the home active environment to change how-values without reloading the same layer stack.

```mermaid
flowchart LR
  A[Init local toolkit state] --> B[Scan repo and home defaults]
  B --> C[Store canonical resources]
  C --> D[Plugins and environments]
  D --> E[Configured layers]
  E --> F[Apply with environment cascade]
```

## Two apply surfaces

HarnessDeck materializes configuration in two places:

| Surface | Scope | Primary commands |
| --- | --- | --- |
| **Profiles** | Machine-wide home harness paths (`~/.claude/`, `~/.codex/`, …) | `profile use`, `hd <profile-name>` |
| **Projects** | Repository working tree | `layer apply`, `project mirror`, `project drift` |

Profiles answer "what stack runs on this machine by default?" Projects answer "what baseline does this repo get?" See [Profiles](./profiles.md) and [Projects](./projects.md).

## Where to go next

| Topic | Page |
| --- | --- |
| Layers, plugins, pins, catalog | [Layers](./layers.md) |
| Scan, import, canonical library | [Resources](./resources.md) |
| Machine-wide home harness state | [Profiles](./profiles.md) |
| Repo apply, mirror, drift, snapshots | [Projects](./projects.md) |
| Harness matrix and resource types | [Supported harnesses](../../supported-harnesses.md) |
| Cross-harness fidelity caveats | [Portability limits](../../portability-limits.md) |
| Full CLI surface | [Command reference](../command-reference.md) |

Full specification: [SPEC.md](https://github.com/harnessdeck/harnessdeck/blob/main/SPEC.md) in the HarnessDeck repository.
