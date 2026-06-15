# Scenario 31: Import dual-mode plugin repo

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a repository contains **both** harness project files (for example
`AGENTS.md`, `CLAUDE.md`) **and** a plugin manifest at the repo root (for example
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or
`.github/plugin/plugin.json`). Without plugin-source import, a normal project
scan only sees harness files and misses repo-root `skills/`, `commands/`, and
`hooks/` trees that the plugin manifest describes.

Typical commands:

```bash
# Preview harness + plugin-source imports (default: auto when layout detected)
harnessdeck project scan . --dry-run

# Force plugin-source merge even when no manifest is auto-detected
harnessdeck project scan . --include-plugin-source always

# Skip plugin-source import (harness files only)
harnessdeck project scan . --include-plugin-source never

# Scope to one harness
harnessdeck project scan . --harness claude-code --include-plugin-source auto

# Build a layer from the merged scan (layer from-project always merges both)
harnessdeck layer from-project ponytail-layer --project .
harnessdeck layer show ponytail-layer
```

`--include-plugin-source` accepts `auto` (default), `always`, or `never`.

- **auto** — merge plugin-source when a recognized manifest exists (`.cursor-plugin/`,
  `.claude-plugin/`, `.codex-plugin/`, `.github/plugin/`).
- **always** — always attempt plugin-source scan.
- **never** — harness scan only.

Dry-run output shows two sections when both sides contribute: harness platforms
and plugin imports. Imported plugin resources carry provenance metadata
(`source_plugin_kind`, `relative_path`) for audit and `resource sync`.

See [portability limits](../portability-limits.md) for what plugin import does
and does not cover (hooks with install-time paths, runtime-only adapters).
