---
description: Apply plugins and compile local APM primitives into harness directories.
---

# Apply to a project (Use)

`ht apply` resolves a plugin graph and writes harness files. With no plugin selector, it is the same loop as [`ht install`](./install.md): read `apm.yml`, resolve manifest dependencies, compile local primitives, write `apm.lock.yaml`, and materialize the **resolved** target harness directories — the same writers used for library plugins, not a second output tree.

Default teammate onboarding in a repo that already has `apm.yml` is `ht install`. Commit `apm.lock.yaml` plus the generated harness output (`.claude/`, `.cursor/`, `AGENTS.md`, and so on). Preview targets with `ht targets`. [`ht compile`](./compile.md) is the same apply-from-manifest loop under a named entry.

```bash
ht install
ht apply
ht apply engineering-foundation --project .
ht apply --target cursor,claude
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

Harness selection is the same for `ht compile`, `ht targets`, `ht install`, and apply-from-manifest:

1. `--target` / `--all` / `--harness` on the command line
2. `targets` / `target` in `apm.yml`
3. `compilation.target` when the top-level target fields are omitted
4. Project harness preference, then global harness preference
5. Auto-detection from documented filesystem signals, then HT `detectPlatforms`

`ht compile`, `ht install`, and apply-from-manifest fail closed when no target can be resolved after that chain. `ht apply <plugin>` uses the same order.

Declared `targets:` wins over harness preference and machine-local folder detection so lockfile and harness ownership stay portable.

`compilation.exclude` skips matching source paths. `compilation.strategy: distributed` is noted and ignored — apply/compile write the existing single-file root context (`AGENTS.md` / `CLAUDE.md`), not per-directory compile output.

## Integrity

Generated files are scanned for hidden Unicode before write. Critical findings block apply unless `--force` is passed. Deployed paths and SHA-256 digests are recorded in `apm.lock.yaml` (`local_deployed_file_hashes`). A later apply rehashes and fails closed on mismatch, extra, or missing files unless you pass `--update`. Symlinks and `..` path escapes in `.apm/` fail closed.

If `apm-policy.yml` is present (or `apm.yml` pins `policy.hash`), apply evaluates it against the install plan before writing harness files. `ht audit --ci` is the CI entry for the same policy plus Unicode/hash checks.

## Executable trust

When `apm.yml` declares `executables:` (even `{}`) or `apm-policy.yml` has a non-empty `executables:` block, hooks, `bin/` executables, and self-defined MCP from dependency packages are parked until approved. Text primitives and local `.apm/` stay deployed. Apply still succeeds and prints `ht approve <ref>`. Each locked dep records `exec_status` (`deployed` / `gated_pending_approval` / `denied` / `absent`).

```bash
ht approve owner/repo
ht deny owner/repo
ht policy explain owner/repo
```

`--user` writes `~/.harnesstap/config.jsonc` (can only narrow). See [Command reference](../command-reference.md#approve).

See also: [Install a project](./install.md), [Compile for declared targets](./compile.md), [Command reference](../command-reference.md), [Pack a bundle](../author/pack.md), [Audit a project](./audit.md).
