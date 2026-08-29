---
description: Audit a project for hidden Unicode, lockfile hash drift, and apm-policy.yml.
---

# Audit a project (Use)

`ht audit` is the on-demand security check for files that agents will read. Built-in protection already runs on `ht apply` (and `ht pack`); use audit locally or in CI to re-scan a tree, inspect a file obtained outside HarnessTap, or remediate hidden characters. When `apm-policy.yml` is present, audit loads it and evaluates the install plan (manifest + lockfile + local tree).

```bash
ht audit
ht audit --file .cursorrules
ht audit --ci --format json
ht audit --ci --require-policy
ht audit --strip --dry-run
```

## What it scans

With no flags, audit scans lockfile-recorded deployed files (`local_deployed_file_hashes` in `apm.lock.yaml`) plus local primitive dirs (`.apm/agents|skills|commands|hooks` and root `agents|skills|commands|hooks`) and root context files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`).

`--file` scans one path instead. The path must stay inside the project root (`..` and symlink escapes are rejected).

## Flags

| Flag | Purpose |
| ---- | ------- |
| `--file <path>` | Scan a single file |
| `--ci` | Fail on critical hidden Unicode, lockfile SHA-256 mismatch / extra / missing, or blocking policy |
| `--policy <path>` | Policy file (default `apm-policy.yml` at the project root) |
| `--require-policy` | With `--ci`, fail if no policy file is present |
| `--strip` | Remove critical and warning characters (preserves emoji ZWJ sequences) |
| `--dry-run` | Preview `--strip` without writing |
| `--project <path>` | Project directory (default `.`) |
| `--format json` | Machine-readable report |

`--ci` cannot be combined with `--strip`, `--file`, or `--dry-run`. `--dry-run` requires `--strip`. `--require-policy` requires `--ci`.

## Policy

`apm-policy.yml` at the project root is optional. Without it, audit still runs Unicode and path checks and reports `policy: skipped`. A pinned `policy.hash` on `apm.yml` is fail-closed: missing or mismatched policy bytes fail, including under `--ci`.

Slice 1 evaluates:

- **Sources** — `dependencies.allow` / `deny` against git hosts (`github.com/*`), catalog identities, and local paths
- **Primitives** — `manifest.content_types.allow` (`skill`, `agent`, `command`, `hook`, `instruction`, `mcp`)
- **Transitive MCP** — undeclared MCP from depth > 0 fails unless `mcp.allow` lists it or `mcp.trust_transitive: true`

`enforcement: block` (and load/hash failures) fail `--ci` and abort `ht apply` before any byte is written. `enforcement: warn` reports violations without changing the exit code.

When the executable trust gate is on, `executables.require` packages whose executables are untrusted fail `--ci` with `required-executable-untrusted`. Approve them with `ht approve <ref>` (or deny explicitly). Lockfile `exec_status` records the resolved state per dep.

See also: [Apply to a project](./apply.md).

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Clean, info-only, or successful `--strip` |
| `1` | Critical Unicode, or `--ci` integrity failure |
| `2` | Warning-only findings, or mutually exclusive flags |

Apply already blocks critical Unicode before writing unless you pass `ht apply --force`. Hash drift on a later apply fails closed; refresh with `ht apply --update`.

See also: [Command reference](../command-reference.md), [Pack a bundle](../author/pack.md).
