---
description: Compile local .apm/ primitives into resolved target harness directories.
---

# Compile for declared targets (Use)

`ht compile` is a named entry over the existing apply-from-manifest path used by [`ht install`](./install.md) / [`ht apply`](./apply.md) with no plugin selector. Same writers, same `local_deployed_file_hashes`. It is not a second output tree and not an instruction-only compile.

```bash
ht compile
ht compile --target cursor
ht compile -t claude,cursor --dry-run
ht compile --all
ht targets
```

## Resolution order

1. `--target` / `--all` / `--harness` on the command line (`--target` and `--harness` occupy the same slot and are mutually exclusive with `--all`)
2. `targets:` (or singular `target`) in `apm.yml`, then `compilation.target` when those fields are omitted
3. Project harness preference, then global harness preference (`ht init --main` / `ht harness set`)
4. Auto-detection from documented filesystem signals (`.cursor/`, `.claude/`, `CLAUDE.md`, …), then HT `detectPlatforms`

Preview the table with `ht targets` (or `ht targets --json`) before compiling. Pin `targets:` so every machine, CI job, and cloud agent writes the same files:

```yaml
name: demo
version: "1.0.0"
targets: [cursor, claude]
```

Declared `targets:` wins over harness preference and whichever tool folders happen to exist on the current machine. When `targets:` is omitted, preference keeps `ht apply <plugin>` / install portable across machines that already ran `ht init --main`.

Canonical slugs: `copilot`, `claude`, `grok-build`, `cursor`, `opencode`, `codex`, `gemini`, `antigravity`, `windsurf`, `kiro`, `agent-skills`. `--all` expands the HT-mapped set including `antigravity` and `kiro`. `agent-skills` is a meta-target and is skipped as a HarnessTap harness. Experimental APM targets that need a feature flag are not accepted.

When nothing resolves after that chain, `ht compile` fails closed the same way as `ht install` / apply-from-manifest.

## What compile does not do

Compile does not take a plugin selector or `--global`. There is no `--watch` and no `--clean`. `compilation.strategy: distributed` is noted and ignored — output stays the existing single-file root context (`AGENTS.md` / `CLAUDE.md`). Use `ht harness list` for the 42-harness registry; `ht targets` is the apply-target preview.

See also: [Install a project](./install.md), [Apply to a project](./apply.md), [Command reference](../command-reference.md).
