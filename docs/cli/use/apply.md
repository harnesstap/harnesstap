---
description: Apply plugins and compile local APM primitives into harness directories.
---

# Apply to a project (Use)

`ht apply` resolves a plugin graph and writes harness files. With no plugin selector, it is the same loop as [`ht install`](./install.md): read `apm.yml`, resolve manifest dependencies, compile local primitives, write `apm.lock.yaml`, and materialize the target harness directories — the same writers used for library plugins, not a second output tree.

Default teammate onboarding in a repo that already has `apm.yml` is `ht install`. Commit `apm.lock.yaml` plus the generated harness output (`.claude/`, `.cursor/`, `AGENTS.md`, and so on).

```bash
ht install
ht apply
ht apply engineering-foundation --project .
ht apply --harness claude-code,cursor
```

## Local primitives

Source files live under `.apm/` (`agents`, `skills`, `commands`, `hooks`, plus `instructions` and `prompts` when present). `.apm/` wins over root `agents/` / `skills/` / `commands/` / `hooks/`; skipped root sources print the same warning as `ht pack`. Without `.apm/`, those root directories are sources.

`ht apply` turns those files into HarnessTap resources and materializes them through the existing harness serializers:

| Source | Resource | Typical harness output |
| ------ | -------- | ---------------------- |
| `.apm/skills/<name>/SKILL.md` | skill | `.claude/skills/`, `.agents/skills/`, … |
| `.apm/agents/*` | agent | `.claude/agents/`, `.cursor/agents/`, … |
| `.apm/commands/*` and `.apm/prompts/*` | command | `.claude/commands/`, … |
| `.apm/hooks/*.json` | hook | `.claude/settings.json`, `.cursor/hooks.json`, … |
| `.apm/instructions/*` with `applyTo` | rule | `.claude/rules/`, `.cursor/rules/`, … |
| `.apm/instructions/*` without `applyTo` | instruction | `CLAUDE.md`, `AGENTS.md`, … |

Skill `scripts/` and `references/` ride along when the serializer emits a skill folder.

## Targets

Harness selection is:

1. `--harness` on the command line
2. `targets` / `target` in `apm.yml`
3. `compilation.target` when the top-level target fields are omitted
4. Project / global harness preference, then filesystem detection

`compilation.exclude` skips matching source paths. `compilation.strategy: distributed` is noted and ignored — apply writes the existing single-file root context (`AGENTS.md` / `CLAUDE.md`), not per-directory compile output. There is no `ht compile` / `apm compile` command.

## Integrity

Generated files are scanned for hidden Unicode before write. Critical findings block apply unless `--force` is passed. Deployed paths and SHA-256 digests are recorded in `apm.lock.yaml` (`local_deployed_file_hashes`). A later apply rehashes and fails closed on mismatch, extra, or missing files unless you pass `--update`. Symlinks and `..` path escapes in `.apm/` fail closed.

See also: [Install a project](./install.md), [Command reference](../command-reference.md), [Pack a bundle](../author/pack.md), [Audit a project](./audit.md).
