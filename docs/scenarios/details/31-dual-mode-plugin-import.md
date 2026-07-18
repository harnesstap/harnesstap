# Scenario 31: Import dual-mode plugin repo

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a repository contains **both** harness project files (for example
`AGENTS.md`, `CLAUDE.md`) **and** a plugin manifest at the repo root (for example
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or
`.github/plugin/plugin.json`). A normal scan automatically merges
harness files with repo-root `skills/`, `commands/`, and `hooks/` trees that the
plugin manifest describes.

Typical commands:

```bash
# Preview harness + plugin-source imports (merged when a manifest is present)
harnesstap scan . --dry-run

# Scope to one harness
harnesstap scan . --harness claude-code

# Build a layer from the merged scan (layer from-project always merges both)
harnesstap layer from-project my-layer --project .
harnesstap layer show my-layer
```

Dry-run output shows two sections when both sides contribute: harness platforms
and plugin imports. Imported plugin resources carry provenance metadata
(`source_plugin_kind`, `relative_path`) for audit and `resource sync`.

See [portability limits](../../portability-limits.md) for what plugin import does
and does not cover (hooks with install-time paths, runtime-only adapters).
