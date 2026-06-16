# Portability limits

HarnessDeck bridges agent configuration across harnesses by canonicalizing
resources (skills, instructions, rules, MCP servers, hooks, agents, commands)
and re-emitting them through per-harness serializers. Most static, file-based
configuration round-trips faithfully. Some surfaces are runtime-only, host-specific,
or require a plugin install tree — HarnessDeck imports metadata where possible
but does not claim full fidelity for those cases.

This document summarizes what transfers well, what transfers partially, how
harness-specific surfaces are handled during mirror, and practical workarounds.
It was informed by stress-testing against multi-harness plugin repos that mix
`.claude-plugin/` (and similar) layouts with per-harness project files.

## Fully bridgeable

These resource types scan, compose in layers, and serialize to native on-disk
paths for supported harnesses:

| Type | Notes |
| ---- | ----- |
| **Skills** | `SKILL.md` bodies and frontmatter; emitted to harness-native skill dirs unless `skillEmission` is `instruction-only` (see below). |
| **Instructions** | `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, `.github/copilot-instructions.md`, and similar always-on context files. Shared `AGENTS.md` is canonicalized once during scan. |
| **Rules** | `.cursor/rules/*.mdc`, `.claude/rules/`, `.windsurf/rules/`, `.clinerules/`, `.kiro/steering/`, and directory-based rule trees. |
| **MCP servers** | stdio and HTTP transports from `.mcp.json`, `.codex/config.toml`, and harness-specific MCP config files. |
| **Static commands** | Markdown (`.md`) and TOML (`.toml`) command definitions from `commands/` trees and plugin manifest pointers. |
| **Agents** | Subagent manifests under harness `agents/` dirs. Codex uses `.toml` (`developer_instructions`); Claude/Cursor/Copilot use markdown + YAML. Cross-harness apply maps `model`, `reasoning_effort`, and read-only semantics; see [supported-harnesses — agent bridging](supported-harnesses.md#agent--subagent-bridging). |

Plugin-source discovery covers `.cursor-plugin/`, `.claude-plugin/`, `.codex-plugin/`,
and `.github/plugin/` manifests. `project scan` automatically merges repo-root
plugin trees with harness project files when a recognized manifest is present.

## Partially bridgeable

### Agent host-specific fields

Claude Code subagents support rich frontmatter (`tools`, `disallowedTools`, `mcpServers`, `hooks`, `isolation`, `skills`, …) that other harnesses do not model. HarnessDeck preserves unknown keys in `metadata.extra` for same-harness round-trip but does not translate them when applying a layer to Codex or Cursor.

### Hooks with `PLUGIN_ROOT` paths

Hooks are imported from `hooks/hooks.json`, `hooks/copilot-hooks.json`, and
plugin manifest `hooks` pointers. HarnessDeck stores event metadata and command
strings as canonical `hook` resources.

Hook commands that reference `${CLAUDE_PLUGIN_ROOT}`, `${CURSOR_PLUGIN_ROOT}`,
or similar install-time variables only work after the host installs the plugin.
HarnessDeck can emit hook JSON, but the shell commands inside often assume the
plugin is present at the host's plugin install path. Treat imported hooks as
documentation of intent; verify behavior after `resource sync` or a native
plugin install.

### Copilot namespaced commands

GitHub Copilot discovers commands under `.github/copilot/commands/` with
namespaced filenames. HarnessDeck imports and emits command content, but
Copilot's runtime may require specific naming conventions or a
`copilot plugin install` step for plugin-packaged commands. Layer apply to
`github-copilot` uses `skillEmission: instruction-only` — skills merge into
`.github/copilot-instructions.md` rather than `.agents/skills/`.

## Harness-specific surfaces and mirror warnings

HarnessDeck scans as much as possible from every supported layout. When a
surface is native to one harness and cannot be transposed to the main harness
or alias harnesses during `project mirror`, HarnessDeck emits a warning per
surface (human output and `surface_warnings` in JSON).

Examples of surfaces that stay on their native harness:

| Surface | Native harness | Mirror behavior |
| ------- | -------------- | --------------- |
| **OpenCode server plugins** (`.mjs`) | OpenCode | Registered in `opencode.json`; not copied to alias harnesses. |
| **Pi extensions** (`pi-extension/`) | Pi | Installed via Pi CLI; not emitted to other harnesses. |
| **Gemini extension manifest** (`gemini-extension.json`) | Gemini CLI / Antigravity | Extension metadata applies to Gemini-family hosts only. |
| **Statusline hooks** | Claude Code (and similar) | Terminal chrome integrations; not part of the shared resource model. |
| **Runtime mode / session config** | Host-specific | Environment variables and `~/.config/…` state are outside layer resources. |

Warnings look like:

```text
opencode surface .opencode/plugins/foo.mjs is not mirrored to codex, cursor: OpenCode server plugins must stay registered in opencode.json on OpenCode.
```

Review mirror output with `--dry-run` before writing alias harness files.

## Intentional per-host tailoring

Some multi-harness repos hand-tune per-host copies rather than sharing one
canonical file. Consistency scripts (for example validating adapter-specific
rule files against a canonical source) are a repo maintenance pattern.

HarnessDeck takes a different approach: **merge and canonicalize** resources in
the local database, then emit per-harness output through serializers. It does
not replicate hand-tuned adapter copies or run post-apply consistency scripts.
If your repo relies on per-host wording differences, review `layer apply --dry-run`
output per harness and adjust layer composition or project harness preferences
rather than expecting byte-identical copies across hosts.

### Instruction-tier emission (`skillEmission`)

Several harnesses declare `skillEmission: instruction-only` in the registry:

- `windsurf` → `.windsurf/rules/{name}.md`
- `cline` → `.clinerules/{name}.md` (or merged into a single rules file)
- `github-copilot` → sections appended to `.github/copilot-instructions.md`
- `gemini-cli` → instruction/rules paths per the Gemini serializer
- `kiro` → `.kiro/steering/{name}.md`

This matches how those hosts load always-on context instead of agent-requested
skill directories. Native skill paths (`.agents/skills/`, `.claude/skills/`, etc.)
are used for harnesses without `instruction-only` emission.

### Cursor skill modes (`cursor_skill_mode` / `skillCursorMode`)

Cursor project apply and mirror honor a project-level `cursor_skill_mode` stored
in `project_harnesses`:

| Mode | Behavior |
| ---- | -------- |
| `agent-requested` (default) | Skills emit as `.cursor/rules/*.mdc` with `alwaysApply: false`. |
| `always-on` | Skills emit as `.cursor/rules/*.mdc` with `alwaysApply: true`. |
| `agents-skills` | Skills emit to `.agents/skills/{name}/SKILL.md` (Cursor's newer skills path). |

Inspect current value with `harnessdeck harness project status --project . --format json`.

## Workarounds

When auto-bridging hits a limit, combine these patterns:

### Plugin pins + `resource sync`

Pin marketplace or local plugins in a layer (`layer combine`, `layer show`).
After the host installs the plugin, refresh HarnessDeck's library copy:

```bash
harnessdeck resource sync --dry-run
harnessdeck resource sync <plugin-selector> --overwrite
```

This re-imports skills, commands, and hooks from install trees under
`~/.claude/plugins/`, `~/.cursor/plugins/`, and similar locations.

### Dual-mode scan for plugin-only repos

Repos with `AGENTS.md` plus `.claude-plugin/plugin.json` but no `.claude/` tree
are scanned automatically — plugin-source resources merge with harness files:

```bash
harnessdeck project scan . --dry-run
harnessdeck layer from-project my-layer --project .
```

### Mirror fallback for empty main harness

When the main harness has no on-disk tree (plugin-only layout):

```bash
harnessdeck project mirror . --reference auto --dry-run
harnessdeck project mirror . --reference plugin
```

`--reference auto` tries the main harness first, then plugin source, then
shared `AGENTS.md` instruction resources.

### Copilot plugin install

For GitHub Copilot plugin-packaged commands and hooks, install through Copilot's
plugin mechanism after layer apply:

```bash
copilot plugin install <source>
harnessdeck resource sync --overwrite
```

Then re-run `layer apply` or `project mirror` if alias harnesses need refreshed
copies.

## Related scenarios

- [Scenario 31](./scenarios/details/31-dual-mode-plugin-import.md) — import dual-mode plugin repos
- [Scenario 32](./scenarios/details/32-instruction-tier-apply.md) — apply to instruction-tier harnesses
- [Scenario 33](./scenarios/details/33-mirror-plugin-fallback.md) — mirror with plugin-source fallback
- [Scenario 34](./scenarios/details/34-portability-limits.md) — understand portability limits
