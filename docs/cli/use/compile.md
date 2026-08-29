---
description: Compile local .apm/ primitives into resolved target harness directories.
---

# Compile for declared targets (Use)

`ht compile` writes local `.apm/` primitives into the harness directories for the **resolved target set**. It reuses the same writers as [`ht install`](./install.md) / [`ht apply`](./apply.md) — not a second compile pipeline.

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
3. Auto-detection from documented filesystem signals (`.cursor/`, `.claude/`, `CLAUDE.md`, …)

Preview the table with `ht targets` (or `ht targets --json`) before compiling. Pin `targets:` so every machine, CI job, and cloud agent writes the same files:

```yaml
name: demo
version: "1.0.0"
targets: [cursor, claude]
```

Declared `targets:` wins over whichever tool folders happen to exist on the current machine.

Canonical slugs: `copilot`, `claude`, `grok-build`, `cursor`, `opencode`, `codex`, `gemini`, `antigravity`, `windsurf`, `kiro`, `agent-skills`. `antigravity` is explicit-only (not part of `--all`). `agent-skills` is a meta-target and is skipped as a HarnessTap harness. Experimental APM targets that need a feature flag are not accepted.

When nothing resolves, `ht compile` writes nothing and exits 0. `ht install` fails closed in that case.

## What compile does not do

Compile does not resolve `dependencies.apm`, rewrite `apm.lock.yaml`, evaluate `apm-policy.yml`, or run the executable trust gate. Use `ht install` for onboarding. `compilation.strategy: distributed` is noted and ignored — output stays the existing single-file root context (`AGENTS.md` / `CLAUDE.md`).

See also: [Install a project](./install.md), [Apply to a project](./apply.md), [Command reference](../command-reference.md).
