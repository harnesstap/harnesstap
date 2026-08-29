---
description: Apply git dependencies declared in apm.yml.
---

# Apply git dependencies (Use)

`ht install` (and `ht apply` with no plugin selector) reads `apm.yml` and can pull a git entry from `dependencies.apm`. HarnessTap resolves the ref to an exact commit, fetches that SHA, and records the identity in `apm.lock.yaml`. It does not invoke Microsoft's `apm` CLI.

```bash
ht install
ht apply --update
```

## Declare a git dependency

String form (`owner/repo`, a git URL, optional `#ref`):

```yaml
dependencies:
  apm:
    - acme/ship-kit#v1.2.3
    - https://github.com/acme/ship-kit.git#main
    - git@github.com:acme/ship-kit.git
```

Object form for a virtual package path or a semver range against tags:

```yaml
dependencies:
  apm:
    - git: acme/ship-kit
      ref: "^1.0.0"
      path: packages/ship
```

`ref` (or `#version`) may be a branch, tag, commit SHA, or a semver range matched against git tags. `path` selects a subdirectory or a virtual file (`.prompt.md`, `.instructions.md`, `.agent.md`). Paths that escape the repo fail closed.

## Lock and replay

The first apply writes `apm.lock.yaml` with the clone identity (`repo_url`, `resolved_commit`, the declared ref or constraint, `path` when set) plus SHA-256 hashes of the files that were deployed.

A later `ht install` or `ht apply` without `--update` reuses the locked commit. `--update` re-resolves the ref (or HEAD when none was declared) and refreshes the lock.

Apply deploys only lockfile-attested files. Path traversal, symlinks, and SHA-256 drift fail closed. Refresh hashes with `ht apply --update`.

`apm-policy.yml` can restrict git hosts (and catalog / local sources) before apply writes. Re-check in CI with `ht audit --ci`.

See also: [Install a project](./install.md), [Command reference](../command-reference.md), [Audit a project](./audit.md), [Pack a bundle](../author/pack.md).
