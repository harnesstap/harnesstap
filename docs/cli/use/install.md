---
description: Onboard a project from apm.yml.
---

# Install a project (Use)

`ht install` is the default onboarding command in a repo that already has `apm.yml`. It is the same loop as `ht apply` with no plugin selector — not a second resolver and not Microsoft's `apm` CLI.

A teammate who has never used HarnessTap can `git clone` and run:

```bash
ht install
```

That reads repo-root `apm.yml`, resolves `dependencies.apm` / `dependencies.mcp`, compiles local `.apm/` primitives, writes `apm.lock.yaml`, and materializes the existing harness directories (`.claude/`, `.cursor/`, `AGENTS.md`, and so on).

Commit `apm.lock.yaml` plus the generated harness output so the next clone installs the same tree.

```bash
ht install
ht install --project .
ht install --harness claude-code,cursor
ht install --dry-run
ht install --update
ht install --force
```

## Same loop as apply

`ht apply` with no plugin selector is the same command. Use `ht apply <plugin>` when you want to materialize a named library, catalog, or packed bundle instead of the repo manifest.

Flags match project-scope apply: `--project`, `--dry-run`, `--update`, `--force`, `--harness` (and the other apply project flags). There is no plugin selector and no `--global`.

When `executables:` is opted in, unapproved executable primitives from deps are parked; install still succeeds and prints `ht approve <ref>`. See [Apply to a project](./apply.md#executable-trust).

Export the recorded inventory with [`ht lock export`](./lock-export.md) (CycloneDX / SPDX from the lockfile; not an attestation).

See also: [Apply to a project](./apply.md), [Apply git dependencies](./apply-git-deps.md), [Command reference](../command-reference.md).
