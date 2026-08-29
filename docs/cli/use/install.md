---
description: Onboard a project from apm.yml.
---

# Install a project (Use)

`ht install` is the default onboarding command in a repo that already has `apm.yml`. It is the same loop as `ht apply` with no plugin selector — not a second resolver and not Microsoft's `apm` CLI.

A teammate who has never used HarnessTap can `git clone` and run:

```bash
ht install
```

That reads repo-root `apm.yml`, resolves `dependencies.apm` / `dependencies.mcp` (including [MCP Registry v0.1](https://registry.modelcontextprotocol.io) identities such as `io.github.github/github-mcp-server`), compiles local `.apm/` primitives, writes `apm.lock.yaml`, and materializes the **resolved** target harness directories (`.claude/`, `.cursor/`, `AGENTS.md`, and so on). Pin `targets:` so the written set does not follow whichever tool folders exist on the current machine. Preview with `ht targets`. [`ht compile`](./compile.md) is the same apply-from-manifest loop under a named entry.

Commit `apm.lock.yaml` plus the generated harness output so the next clone installs the same tree.

```bash
ht install
ht install --project .
ht install --target cursor,claude
ht install --mcp io.github.github/github-mcp-server --target cursor
ht install --harness claude-code,cursor
ht install --dry-run
ht install --update
ht install --force
```

## Same loop as apply

`ht apply` with no plugin selector is the same command. Use `ht apply <plugin>` when you want to materialize a named library, catalog, or packed bundle instead of the repo manifest.

Flags match project-scope apply: `--project`, `--dry-run`, `--update`, `--force`, `--target`, `--all`, `--harness` (and the other apply project flags). There is no plugin selector and no `--global`. Install fails closed when no target can be resolved.

When `executables:` is opted in, unapproved executable primitives from deps are parked; install still succeeds and prints `ht approve <ref>`. Root `dependencies.mcp` is depth 0 and is not parked. See [Apply to a project](./apply.md#executable-trust).

## MCP Registry identities

Bare `dependencies.mcp` strings such as `io.github.github/github-mcp-server` are MCP Registry v0.1 identities. `ht install` fetches `GET /v0.1/servers/{id}/versions/latest` from `registry.modelcontextprotocol.io` (override with `HARNESSTAP_MCP_REGISTRY_URL`) and writes the **same native MCP files** already emitted for harnesses HT serializes.

Resolution: prefer a registry `remotes[]` HTTP/SSE URL when present; otherwise pick the first package in `npm` → `oci` → `pypi` → `nuget` order and emit `npx` / `docker run -i --rm` / `uvx` / `dnx`. Secret headers and env stay `${VAR}` placeholders. HT does not inject a GitHub PAT and does not add VS Code / JetBrains / Windsurf / Kiro adapters it does not already serialize.

Self-defined entries (`registry: false` with `command` / `url`) skip the registry. `ht install --mcp <id>` and `ht mcp install <id>` append the identity to `apm.yml` then run install; a failed install rolls the manifest write back. `ht mcp search|list|show` are cheap registry discovery.

Export the recorded inventory with [`ht lock export`](./lock-export.md) (CycloneDX / SPDX from the lockfile; not an attestation).

See also: [Apply to a project](./apply.md), [Compile for declared targets](./compile.md), [Apply git dependencies](./apply-git-deps.md), [Command reference](../command-reference.md).
