---
description: Audit a project for hidden Unicode and lockfile hash drift.
---

# Audit a project (Use)

`ht audit` is the on-demand security check for files that agents will read. Built-in protection already runs on `ht apply` (and `ht pack`); use audit locally or in CI to re-scan a tree, inspect a file obtained outside HarnessTap, or remediate hidden characters.

```bash
ht audit
ht audit --file .cursorrules
ht audit --ci --format json
ht audit --strip --dry-run
```

## What it scans

With no flags, audit scans lockfile-recorded deployed files (`local_deployed_file_hashes` in `apm.lock.yaml`) plus local primitive dirs (`.apm/agents|skills|commands|hooks` and root `agents|skills|commands|hooks`) and root context files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`).

`--file` scans one path instead. The path must stay inside the project root (`..` and symlink escapes are rejected).

## Flags

| Flag | Purpose |
| ---- | ------- |
| `--file <path>` | Scan a single file |
| `--ci` | Fail on critical hidden Unicode or lockfile SHA-256 mismatch / extra / missing |
| `--strip` | Remove critical and warning characters (preserves emoji ZWJ sequences) |
| `--dry-run` | Preview `--strip` without writing |
| `--project <path>` | Project directory (default `.`) |
| `--format json` | Machine-readable report |

`--ci` cannot be combined with `--strip`, `--file`, or `--dry-run`. `--dry-run` requires `--strip`.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Clean, info-only, or successful `--strip` |
| `1` | Critical Unicode, or `--ci` integrity failure |
| `2` | Warning-only findings, or mutually exclusive flags |

Apply already blocks critical Unicode before writing unless you pass `ht apply --force`. Hash drift on a later apply fails closed; refresh with `ht apply --update`.

See also: [Command reference](../command-reference.md), [Pack a bundle](../author/pack.md).
