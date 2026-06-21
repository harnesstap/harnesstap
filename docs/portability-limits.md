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
| **Skills** | `SKILL.md` bodies and frontmatter; emitted to harness-native skill dirs unless `skillEmission` is `instruction-only` (see below). When the scan origin is still available (`origin_ref` / `skillSourceRoot`), `scripts/` and `reference(s)/` files are copied alongside `SKILL.md`. |
| **Hooks** | Imported from plugin `hooks/hooks.json`, harness `hooks.json` files (Cursor, Codex), and Claude `.claude/settings.json`. Nested PostToolUse matchers are preserved on emit for Claude Code, Cursor, and Codex. |
| **Instructions** | `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, `.github/copilot-instructions.md`, and similar always-on context files. Shared `AGENTS.md` is canonicalized once during scan. |
| **Rules** | `.cursor/rules/*.mdc`, `.claude/rules/`, `.windsurf/rules/`, `.clinerules/`, `.kiro/steering/`, and directory-based rule trees. |
| **MCP servers** | stdio and HTTP transports from `.mcp.json`, `.codex/config.toml`, and harness-specific MCP config files. |
| **Static commands** | Markdown (`.md`) and TOML (`.toml`) command definitions from `commands/` trees, plugin manifest pointers, and skill `scripts/command-metadata.json` sub-commands. |
| **Agents** | Subagent manifests under harness `agents/` dirs. Codex uses `.toml` (`developer_instructions`); Claude/Cursor/Copilot use markdown + YAML. Cross-harness apply maps `model`, `reasoning_effort`, and read-only semantics; see [supported-harnesses — agent bridging](supported-harnesses.md#agent--subagent-bridging). |

Plugin-source discovery covers `.cursor-plugin/`, `.claude-plugin/`, `.codex-plugin/`,
and `.github/plugin/` manifests. Manifest `skills`, `commands`, and `hooks` pointers
are resolved relative to the plugin root (for example `./.claude/skills/` on repos
like [Impeccable](https://github.com/pbakaus/impeccable)). Claude marketplace
manifests may use `"source"` instead of `"path"` for plugin entry locations.

`project scan` automatically merges repo-root plugin trees with harness project
files when a recognized manifest is present. If the manifest exists but the
conventional `skills/` tree is absent, harness scan still proceeds (dual-mode
merge no longer aborts the import). When the root manifest yields no resources,
HarnessDeck falls back to the first plugin pack listed in a repo-root
`marketplace.json` when present.

## MCP authentication and environments

HarnessDeck environments switch **static** MCP credentials (API keys, bot tokens,
`${VAR}` placeholders in MCP `env`, `args`, or `headers`) via `secret_ref` and
the home → layer-default cascade. They do **not** switch **OAuth 2.1** sessions
that hosts store in OS keychains or private token caches (Cursor, Claude Code,
Copilot CLI, VS Code).

| Auth model | HarnessDeck can switch? | Mechanism |
| ---------- | ----------------------- | --------- |
| API key / PAT / bot token in MCP config | Yes | `environment edit --secret` + `${VAR}` substitution on apply |
| OAuth HTTP MCP (browser login in IDE) | No | Token lives in host credential store, not in materialized `mcp.json` |
| Per-host OAuth after `layer apply` | Manual | Log in separately in each target harness |

Full detail, host storage locations, workarounds, and remaining gaps: [Environments — MCP authentication
limitations](./cli/concepts/environments.md#mcp-authentication-limitations).

## Partially bridgeable

### MCP HTTP headers (Cursor)

Cursor HTTP MCP servers often use a `headers` map (for example `Authorization:
Bearer …`). HarnessDeck round-trips `headers` through `McpServerMetadata` and
`mcp-config-bridge`: scan/import preserves them, `${VAR}` substitution applies at
apply time, and the Cursor serializer re-emits them in `.cursor/mcp.json`. OAuth
access tokens in host keychains are still outside this path — see [MCP authentication
and environments](#mcp-authentication-and-environments).

### Agent host-specific fields

Claude Code subagents support rich frontmatter (`tools`, `disallowedTools`, `mcpServers`, `hooks`, `isolation`, `skills`, …) that other harnesses do not model. HarnessDeck preserves unknown keys in `metadata.extra` for same-harness round-trip but does not translate them when applying a layer to Codex or Cursor.

### Skill auxiliary files without scan origin

Skill `scripts/` and `reference(s)/` directories are listed during scan and
emitted on `layer apply` when HarnessDeck can still read the original tree
(typically `origin_ref` from `project scan` or `layer from-project`). Layer
export to another machine without embedded plugin trees still drops auxiliary
files unless you use `hd add` (full tree install) or `--embed-plugins` on export.

### SKILL.md in-body harness paths

Some plugins (including Impeccable) hardcode paths like `.claude/skills/foo/scripts/…`
inside `SKILL.md` bodies. HarnessDeck does not rewrite those strings when applying
to Codex, Cursor, or Windsurf. Prefer `hd add` or per-harness copies when scripts
must run on every host.

### Skill sub-commands vs slash commands

Plugins that expose sub-commands via `scripts/command-metadata.json` and
`reference/*.md` (for example Impeccable's `/impeccable polish`) are imported as
`command` resources named `{skill}:{subcommand}` and emitted to harness-native
command paths (for example `.claude/commands/impeccable:polish.md`). Commands
without a matching reference file get a generated prompt that points back to the
skill reference doc.

### Hooks with `PLUGIN_ROOT` paths

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
| **OpenCode server plugins** (`.js`, `.mjs`) | OpenCode | Registered in `opencode.json`; not copied to alias harnesses. |
| **Pi extensions** (`pi-extension/`) | Pi | Installed via Pi CLI; not emitted to other harnesses. |
| **Gemini extension manifest** (`gemini-extension.json`) | Gemini CLI / Antigravity | Extension metadata applies to Gemini-family hosts only. |
| **Statusline hooks** | Claude Code (and similar) | Terminal chrome integrations; not part of the shared resource model. |
| **Runtime mode / session config** | Host-specific | Environment variables and `~/.config/…` state are outside layer resources. |
| **Goose subagents / plan mode / MOIM / prompt templates** | Goose | Session workflows and per-turn env injection; not file-based layer resources. |

Warnings look like:

```text
opencode surface .opencode/plugins/foo.js is not mirrored to codex, cursor: OpenCode server plugins must stay registered in opencode.json on OpenCode.
```

Review mirror output with `--dry-run` before writing alias harness files.

**Auto reference merge:** with `--reference auto`, HarnessDeck merges repo-root
plugin `skills/` into the main-harness scan when the main tree has instructions
but no on-disk skills (common in superpowers-style layouts). This is separate
from the empty-main fallback chain (main → plugin → `AGENTS.md`).

**Platform detection:** symlinked `AGENTS.md` (for example pointing at
`CLAUDE.md`) does not inflate the detected harness count — only real instruction
files count as distinct AGENTS-based harnesses.

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

Cursor `layer apply` and mirror honor a project-level `cursor_skill_mode` stored
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

Pin marketplace or local plugins in a layer (`layer edit`, `layer show`).
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
- [Scenario 39](./scenarios/details/39-mcp-auth-and-environments.md) — MCP auth, environments, account switching
