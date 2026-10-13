# Vendored Agent Plugins schemas

Copied verbatim from https://github.com/agentplugins/agent-plugins-spec
at tag `v1.0.0` (commit `bd383552095128f6effe895b9257cfd580a6d179`):

- `schemas/1.0.0/plugin.schema.json`
- `schemas/1.0.0/mcp.schema.json`

Licensed under the Apache License 2.0 (see `LICENSE`), as stated in the
upstream `LICENSE.md` for schemas and other software material.

Tests and `bun run check:agent-plugins-spec` load these files from disk.
They never fetch a schema over the network. Do not edit them by hand; to
update, copy the files from a new upstream tag and update this note.

## Conformance fixtures

Copied from https://github.com/agentplugins/agent-plugins-conformance
at commit `6bfce5436435ffed10ab0020ee0f331ddeb640d6` (suite 0.1.0):

- `conformance/agent-plugins-conformance-core`
- `conformance/agent-plugins-conformance-recovery`
- `conformance/agent-plugins-conformance-invalid-mcp`

The probe implementation under `src/` and the built `dist/` bundles are
omitted. The loader tests are static and do not execute those programs.
Escape symlinks at the recovery plugin root are kept so command and cwd
containment can be checked. Code in the fixtures is Apache-2.0 and docs
are CC-BY-4.0 (see `conformance/LICENSE.md`).

Pins the upstream job compares:

- spec tag `v1.0.0` commit `bd383552095128f6effe895b9257cfd580a6d179`
- conformance commit `6bfce5436435ffed10ab0020ee0f331ddeb640d6`
