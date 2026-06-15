# Scenario 34: Understand portability limits

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when planning a multi-harness rollout, evaluating a plugin repo like
ponytail, or debugging why `layer apply` / `project mirror` did not reproduce
every on-disk artifact from the source repo.

Start with the full reference:

**[Portability limits](../portability-limits.md)**

Quick checklist:

```bash
# See what HarnessDeck can import from a dual-mode repo
harnessdeck project scan . --include-plugin-source always --dry-run

# Preview what each harness would receive
harnessdeck layer apply my-setup --project . --harness claude-code,codex,windsurf,opencode --dry-run

# Confirm opencode .mjs server plugins are not emitted (expected)
harnessdeck layer apply my-setup --project . --harness opencode --dry-run

# Check registry capabilities before targeting unfamiliar harnesses
harnessdeck harness list --supported
```

**Fully bridgeable:** skills, instructions, rules, MCP (stdio/http), static
commands (md/toml), agents.

**Partially bridgeable:** hooks (importable, but `${*_PLUGIN_ROOT}` paths need
plugin install), Copilot namespaced commands.

**Not bridgeable:** OpenCode `.mjs` server plugins, pi extensions, runtime mode
state, statusline hooks, Gemini→Antigravity command conversion.

**Workarounds:** layer plugin pins + `resource sync`, dual-mode scan, mirror
`--reference auto|plugin`, and native `copilot plugin install` for Copilot
plugin trees.

Related scenarios: [31](./31-dual-mode-plugin-import.md),
[32](./32-instruction-tier-apply.md), [33](./33-mirror-plugin-fallback.md),
[19](./19-refresh-plugin-metadata.md).
