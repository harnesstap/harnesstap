# Per-harness comparison procedure

Shared by every `harness-docs-<id>` skill.

## 1. Collect upstream facts

- Fetch the changelog or release page first. In incremental mode, read only entries newer than `lastReviewed` / `lastSeenVersion` and note the newest version you saw.
- Fetch the reference pages for each feature area below. Prefer JSON schemas and settings references over tutorials; record the exact keys, file paths, and scopes (project, user, managed or enterprise).
- When a page fails to load (403, bot wall, JavaScript-only), retry with another fetch method, then the vendor's source repo. If it still fails, record it as unverified.

## 2. Read HarnessTap's side

- `src/platforms/registry.ts`: the harness entry lists supported features (`instructions`, `skills`, `rules`, `mcp`, `permissions`, `hooks`, `agents`, `commands`, `env_vars`, `model_config`), project and global paths, `pathAlternates`, `relatedLocations`, `hostManagedPaths`, and `skillEmission`.
- The serializer: the dedicated file under `src/platforms/` or the generic `src/platforms/generic-agents.ts`. Look at what it scans and what it writes for each feature.
- Shared services the serializer calls (MCP bridge, hook serialization, agent bridge, plugin providers under `src/plugins/providers/`).
- Tests under `test/platforms/` show the exact on-disk shapes HarnessTap emits.
- `docs/supported-harnesses.md` and `docs/portability-limits.md` describe known limits; a gap already documented there is "known limitation", not new.

## 3. Classify each feature area

Feature areas to walk for every harness:

| Area | Typical upstream surface |
| ---- | ------------------------ |
| instructions | AGENTS.md, vendor memory files, imports, nested files |
| rules | path-scoped rule files and frontmatter |
| skills | SKILL.md locations and frontmatter keys |
| mcp | config file paths and scopes, transports, `env`, `headers`, OAuth, enable/disable, tool filters, timeouts |
| settings | settings files, scopes, precedence, JSON schema |
| permissions | allow/deny/ask rules, sandbox, approval modes |
| hooks | events, matchers, handler types, file locations |
| agents | subagent or custom agent files and frontmatter |
| commands | slash commands, prompts, workflows, recipes |
| plugins | plugin manifests, marketplaces, install locations |
| env and model | env vars in config, model and provider selection |
| other | anything new that fits none of the above |

For each upstream item pick one status:

- `covered`: HarnessTap scans and emits it. Cite the file.
- `partial`: some keys, scopes, or paths are handled. Cite the file and name what is missing.
- `missing`: upstream supports it, HarnessTap does not.
- `known-limitation`: missing, but documented in `docs/` as out of scope.
- `deprecated`: upstream deprecated or removed it. Flag HarnessTap code that still writes it.
- `unverified`: the source could not be read this run.

## 4. Prioritize backfill

- P0: HarnessTap writes something upstream now rejects, ignores, or treats as a breaking change (data loss, broken config, security regression).
- P1: a widely used upstream surface HarnessTap cannot scan or emit for this harness (for example MCP or hooks on a harness that now documents them), or a moved default path.
- P2: new optional keys, scopes, or frontmatter fields on surfaces HarnessTap already supports.
- P3: nice to have, niche, or preview/experimental features.

Mark an item `shareable` when the same capability exists on two or more harnesses so the orchestrator can group it.
