# Glossary

Domain terms of the original, their meaning, and their name in Rust. Add terms
as units bring them.

| Term | Meaning | Rust name |
| --- | --- | --- |
| harness | A coding agent tool HarnessTap writes config for (Claude Code, Cursor, Codex, ...). 44 are registered. | `Harness` |
| target | A harness slug accepted by `--target` and `apm.yml` `targets:` (`claude`, `cursor`, ...). | `Target` |
| resource | One piece of AI configuration: skill, rule, instruction, agent, command, hook, MCP server. | `Resource` |
| plugin | A named bundle of resources that can be applied to a project or home. | `Plugin` |
| profile | A plugin applied globally (home scope) with `ht profile use`. | `Profile` |
| environment | Values a plugin needs (model, permissions, token references), cascaded. | `Environment` |
| apply | Resolve a plugin's dependency graph and materialize harness files. | `apply` module |
| materialize | Write the generated files for each resolved harness. | `materialize` |
| manifest | `apm.yml` at the project root. | `ApmManifest` |
| lockfile | `apm.lock.yaml`: resolved dependencies and `local_deployed_file_hashes`. | `ApmLock` |
| snapshot | Copy of tracked files taken before apply; restored with `ht revert`. | `Snapshot` |
| library | The local store of resources and plugins (SQLite database plus blob store). | `Library` |
| sidecar agent | The local HTTP server the Desktop app talks to (`ht-agent`, port 7474). | `agent` crate |
| front door | `rust/app`: the Rust `ht` binary that falls back to the original. | `ht` binary |
