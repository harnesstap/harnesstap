# Portability limits

HarnessTap bridges agent configuration across harnesses by canonicalizing
resources (skills, instructions, rules, MCP servers, hooks, agents, commands)
and re-emitting them through per-harness serializers. Most static, file-based
configuration round-trips faithfully. Some surfaces are runtime-only, host-specific,
or require a plugin install tree — HarnessTap imports metadata where possible
but does not claim full fidelity for those cases.

This document summarizes what transfers well, what transfers partially, how
harness-specific surfaces are handled during mirror, and practical workarounds.
It was informed by stress-testing against multi-harness plugin repos that mix
`.claude-plugin/` (and similar) layouts with per-harness project files.

## Agent Plugins round-trip (non-HarnessTap clients)

Portable plugins are Agent Plugins 1.0 packages (directory or `.ap.json` envelope).
A non-HarnessTap AP client loads only the standard surface and ignores the
HarnessTap namespace:

| Package content | Survives in other AP clients? | Notes |
| ---- | ---- | ---- |
| **Skills** (`skills/…/SKILL.md`) | Yes | Standard AP surface |
| **MCP servers** (`mcp.json`) | Yes | Standard AP surface |
| **Rules, hooks, agents, commands, instructions** | No (ignored) | Live under `com.harnesstap/` and `extensions["com.harnesstap"]` |
| **Dependencies, overrides, profile, needs** | No (ignored) | HarnessTap extension fields only |
| **Environment secret values** | Never packaged | `env.toml` holds keys and `${VAR}` references only |

HarnessTap re-imports the full package (standard files plus the namespace). There
is no second portable format — legacy `*.harnesstap.toml` transport files are
rejected.

## Fully bridgeable

These resource types scan, compose in plugins, and serialize to native on-disk
paths for supported harnesses:

| Type | Notes |
| ---- | ----- |
| **Skills** | `SKILL.md` bodies and frontmatter; emitted to harness-native skill dirs unless `skillEmission` is `instruction-only` (see below). When the scan origin is still available (`origin_ref` / `skillSourceRoot`), `scripts/` and `reference(s)/` files are copied alongside `SKILL.md`. |
| **Hooks** | Imported from plugin `hooks/hooks.json`, harness `hooks.json` files (Cursor, Codex), and Claude `.claude/settings.json`. Nested PostToolUse matchers are preserved on emit for Claude Code, Cursor, and Codex. |
| **Instructions** | `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, `.github/copilot-instructions.md`, and similar always-on context files. Shared `AGENTS.md` is canonicalized once during scan. |
| **Rules** | `.cursor/rules/*.mdc`, `.claude/rules/`, `.windsurf/rules/`, `.clinerules/`, `.kiro/steering/`, and directory-based rule trees. |
| **MCP servers** | stdio and HTTP transports from `.mcp.json`, Claude user `~/.claude.json`, `.codex/config.toml`, and harness-specific MCP config files. |
| **Static commands** | Markdown (`.md`) and TOML (`.toml`) command definitions from `commands/` trees, plugin manifest pointers, and skill `scripts/command-metadata.json` sub-commands. |
| **Agents** | Subagent manifests under harness `agents/` dirs. Codex uses `.toml` (`developer_instructions`); Claude/Cursor/Copilot use markdown + YAML. Cross-harness apply maps `model`, `reasoning_effort`, and read-only semantics; see [supported-harnesses — agent bridging](supported-harnesses.md#agent--subagent-bridging). |

Plugin-source discovery covers `.cursor-plugin/`, `.claude-plugin/`, `.codex-plugin/`,
and `.github/plugin/` manifests. Manifest `skills`, `commands`, and `hooks` pointers
are resolved relative to the plugin root (for example `./.claude/skills/` on repos
like [Impeccable](https://github.com/pbakaus/impeccable)). Claude marketplace
manifests may use `"source"` instead of `"path"` for plugin entry locations.

`scan` automatically merges repo-root plugin trees with harness project
files when a recognized manifest is present. If the manifest exists but the
conventional `skills/` tree is absent, harness scan still proceeds (dual-mode
merge no longer aborts the import). When the root manifest yields no resources,
HarnessTap falls back to the first plugin pack listed in a repo-root
`marketplace.json` when present.

## MCP authentication and environments

HarnessTap environments switch **static** MCP credentials (API keys, bot tokens,
`${VAR}` placeholders in MCP `env`, `args`, or `headers`) via `secret_ref` and
the home → plugin-default cascade. They do **not** switch **OAuth 2.1** sessions
that hosts store in OS keychains or private token caches (Cursor, Claude Code,
Copilot CLI, VS Code).

| Auth model | HarnessTap can switch? | Mechanism |
| ---------- | ----------------------- | --------- |
| API key / PAT / bot token in MCP config | Yes | `environment edit --secret` + `${VAR}` substitution on apply |
| OAuth HTTP MCP (browser login in IDE) | No | Token lives in host credential store, not in materialized `mcp.json` |
| Per-host OAuth after `apply` | Manual | Log in separately in each target harness |

Full detail, host storage locations, workarounds, and remaining gaps: [Environments — MCP authentication
limitations](./cli/concepts/environments.md#mcp-authentication-limitations).

### Claude Code MCP scopes

Claude Code stores MCP in two files. HarnessTap follows that split and does **not** dual-write:

| Scope | Upstream path | HarnessTap |
| ----- | ------------- | ---------- |
| **Project** (shared with the team) | `.mcp.json` | Scan + apply (project) |
| **User** (all projects, this machine) | top-level `mcpServers` in `~/.claude.json` | Scan + merge-safe apply (global) |
| **Local** (this project, this user) | `projects[<absPath>].mcpServers` in `~/.claude.json` | Scan / inventory only (dedicated source `~/.claude.json#local:<absPath>`). Never applied to `.mcp.json` or top-level user `mcpServers`. |

`~/.claude.json` also holds OAuth session and per-project trust state. Apply overlays top-level `mcpServers` only and never deletes the file. Local-scope MCP is bound to the exact absolute project path Claude stored (typically the git root where `claude mcp add` ran). HarnessTap does not promote those servers into team `.mcp.json`, merge them into user-scope `mcpServers`, or copy them across harnesses on Sync harnesses. If `CLAUDE_CONFIG_DIR` is set, Claude reads `.claude.json` from that directory instead of `~/.claude.json` — HarnessTap still uses the home path.

## Partially bridgeable

### MCP HTTP headers (Cursor)

Cursor HTTP MCP servers often use a `headers` map (for example `Authorization:
Bearer …`). HarnessTap round-trips `headers` through `McpServerMetadata` and
`mcp-config-bridge`: scan/import preserves them, `${VAR}` substitution applies at
apply time, and the Cursor serializer re-emits them in `.cursor/mcp.json`. OAuth
access tokens in host keychains are still outside this path — see [MCP authentication
and environments](#mcp-authentication-and-environments).

### Agent host-specific fields

Claude Code subagents support rich frontmatter (`tools`, `disallowedTools`, `mcpServers`, `hooks`, `isolation`, `skills`, …) that other harnesses do not model. HarnessTap preserves unknown keys in `metadata.extra` for same-harness round-trip but does not translate them when applying a plugin to Codex or Cursor.

### Skill auxiliary files without scan origin

Skill `scripts/` and `reference(s)/` directories are listed during scan and
emitted on `apply` when HarnessTap can still read the original tree
(typically `origin_ref` from `scan` or `plugin from-project`). Plugin
export to another machine without embedded plugin trees still drops auxiliary
files unless you use `ht add` (full tree install) or `--embed-plugins` on
Agent Plugins package export.

### SKILL.md in-body harness paths

Some plugins (including Impeccable) hardcode paths like `.claude/skills/foo/scripts/…`
inside `SKILL.md` bodies. HarnessTap does not rewrite those strings when applying
to Codex, Cursor, or Windsurf. Prefer `ht add` or per-harness copies when scripts
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
HarnessTap can emit hook JSON, but the shell commands inside often assume the
plugin is present at the host's plugin install path. Treat imported hooks as
documentation of intent; verify behavior after `resource sync` or a native
plugin install.

### Copilot namespaced commands

GitHub Copilot discovers commands under `.github/copilot/commands/` with
namespaced filenames. HarnessTap imports and emits command content, but
Copilot's runtime may require specific naming conventions or a
`copilot plugin install` step for plugin-packaged commands. Plugin apply to
`github-copilot` uses `skillEmission: instruction-only` — skills merge into
`.github/copilot-instructions.md` rather than `.agents/skills/`.

## Harness-specific surfaces and mirror warnings

HarnessTap scans as much as possible from every supported layout. When a
surface is native to one harness and cannot be transposed to the main harness
or alias harnesses during `mirror`, HarnessTap emits a warning per
surface (human output and `surface_warnings` in JSON).

Examples of surfaces that stay on their native harness:

| Surface | Native harness | Mirror behavior |
| ------- | -------------- | --------------- |
| **OpenCode server plugins** (`.js`, `.mjs`) | OpenCode | Registered in `opencode.json`; not copied to alias harnesses. |
| **Pi extensions** (`pi-extension/`) | Pi | Installed via Pi CLI; not emitted to other harnesses. |
| **Gemini extension manifest** (`gemini-extension.json`) | Gemini CLI / Antigravity | Extension metadata applies to Gemini-family hosts only. |
| **Statusline hooks** | Claude Code (and similar) | Terminal chrome integrations; not part of the shared resource model. |
| **Runtime mode / session config** | Host-specific | Environment variables and `~/.config/…` state are outside plugin resources. |
| **Goose subagents / plan mode / MOIM / prompt templates** | Goose | Session workflows and per-turn env injection; not file-based plugin resources. |

Warnings look like:

```text
opencode surface .opencode/plugins/foo.js is not mirrored to codex, cursor: OpenCode server plugins must stay registered in opencode.json on OpenCode.
```

Review mirror output with `--dry-run` before writing alias harness files.

**Auto reference merge:** with `--reference auto`, HarnessTap merges repo-root
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

HarnessTap takes a different approach: **merge and canonicalize** resources in
the local database, then emit per-harness output through serializers. It does
not replicate hand-tuned adapter copies or run post-apply consistency scripts.
If your repo relies on per-host wording differences, review `apply --dry-run`
output per harness and adjust plugin composition or project harness preferences
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

Cursor `apply` and mirror honor a project-level `cursor_skill_mode` stored
in `project_harnesses`:

| Mode | Behavior |
| ---- | -------- |
| `agent-requested` (default) | Skills emit as `.cursor/rules/*.mdc` with `alwaysApply: false`. |
| `always-on` | Skills emit as `.cursor/rules/*.mdc` with `alwaysApply: true`. |
| `agents-skills` | Skills emit to `.agents/skills/{name}/SKILL.md` (Cursor's newer skills path). |

Inspect current value with `harnesstap harness project status --project . --format json`.

### Cursor skill locations (user vs host-managed)

Cursor keeps three distinct skill trees:

| Path | Ownership | HarnessTap |
| ---- | --------- | ---------- |
| `~/.cursor/skills/` | User / personal skills | Global scan, persist, and apply |
| `.agents/skills/` (project, `agents-skills` mode) | Project skills | Project scan / apply when configured |
| `~/.cursor/skills-cursor/` | Cursor app-managed built-ins | **Inventory only** via `profile status` / apply-preview `host_managed.cursor` — never persisted, staged, or applied |

Name collisions between host-managed built-ins and user/profile skills appear as
panel reason `cursor_host_skill_collision` (yellow) and do not flip
`has_drift` / `--check`.

### DeepSeek Harness

DeepSeek Harness is a developer preview; the Cordis patch schema can change.

- Live MCP is applied via `$DSH_HOME/cordis.patch.yml` only — not project MCP files.
- Live hooks are the home-patch `configPath` (`$DSH_HOME/hooks/harnesstap.json`); project `.dsh/hooks/` is scanned and written but not wired into Cordis.
- User agent presets are persona-only and do not include shipped `standard` tools.
- Plugin npm install is `web` profile only (`dsh plugin --profile web add`).
- HarnessTap round-trips `cordis.patch.yml` as plain YAML (`parse`/`stringify`) and does not evaluate `!!js`; tags on user rows may be dropped on the next apply.

## Workarounds

When auto-bridging hits a limit, combine these patterns:

### Plugin pins + `resource sync`

Pin marketplace or local plugins in a plugin (`plugin edit`, `plugin show`).
After the host installs the plugin, refresh HarnessTap's library copy:

```bash
harnesstap resource sync --dry-run
harnesstap resource sync <plugin-selector> --overwrite
```

This re-imports skills, commands, and hooks from install trees under
`~/.claude/plugins/`, `~/.cursor/plugins/`, and similar locations.

### Claude Code ↔ Cursor host plugin trees

There is no shared runtime plugin directory. Agent Plugins 1.0 (`plugin.json`
with an `agent-plugins` schema, plus `skills/` and `mcp.json`) is the closest
common package format. Host-specific manifests stay native:

| Surface | Claude Code | Cursor |
| ------- | ----------- | ------ |
| Install root | `~/.claude/plugins/` (`cache/…`, `installed_plugins.json`) | `~/.cursor/plugins/` (`cache/`, `local/`, `marketplaces/`) |
| Manifest | `.claude-plugin/plugin.json` (also reads `.cursor-plugin/` and root `plugin.json` for version) | `.cursor-plugin/plugin.json` or Agent Plugins root `plugin.json` (also inventories `.claude-plugin/` once the tree is in Cursor's root) |
| Enablement | `enabledPlugins` in `~/.claude/settings.json` plus `installed_plugins.json` | IDE Customize / `/plugin` / MCP `plugin-<name>-<name>` folders; HarnessTap cannot flip Cursor enabled state |
| Loads the other host's tree? | No | No (Desktop may *list* `~/.claude/plugins/` as a related location) |

`ht harness sync` therefore **dual-writes** native trees (copy files into both
roots when both harnesses are in the Settings active set). It does not install
once into Claude and expect Cursor to run it from `~/.claude/plugins/`.

Portable inside a copied tree: skills, `mcp.json`, Agent Plugins root
`plugin.json`, and whichever host manifests were already present. Not portable:
Claude `installed_plugins.json` / marketplace git metadata, Cursor enablement
and `agent plugin marketplace add` auth, hooks that assume
`${CLAUDE_PLUGIN_ROOT}` or `${CURSOR_PLUGIN_ROOT}`, and host-only plugin
config (Claude extra known marketplaces, Cursor app MCP folders).

### Dual-mode scan for plugin-only repos

Repos with `AGENTS.md` plus `.claude-plugin/plugin.json` but no `.claude/` tree
are scanned automatically — plugin-source resources merge with harness files:

```bash
harnesstap scan . --dry-run
harnesstap plugin from-project my-plugin --project .
```

### Mirror fallback for empty main harness

When the main harness has no on-disk tree (plugin-only layout):

```bash
harnesstap mirror . --reference auto --dry-run
harnesstap mirror . --reference plugin
```

`--reference auto` tries the main harness first, then plugin source, then
shared `AGENTS.md` instruction resources.

### Cursor plugin marketplaces

`cursor-public` is Cursor's built-in public marketplace. HarnessTap treats it as a native git source at `https://github.com/cursor/plugins` (marketplace manifest `.cursor-plugin/marketplace.json`; each plugin is a relative path in that repo). Library **Pull** clones or fetches that repo even when Cursor has not installed the marketplace. The checkout lives under the Claude host marketplace root (`~/.claude/plugins/marketplaces/cursor-public`) and is recorded in Claude `known_marketplaces.json`, so Claude Code can install from `plugin@cursor-public` refs. `ht harness sync` copies those trees onto Cursor. Other Cursor marketplaces are still registered with `agent plugin marketplace add` during apply and when `plugin add` targets the active profile. `agent plugin` has no install command; install from Cursor Customize or `/plugin`, then inventory `~/.cursor/plugins/`. Missing `agent` auth or a failed `marketplace list` skips host registration instead of failing apply. HarnessTap never sends `marketplace add` for `cursor-public` (Cursor already has it).

### Copilot plugin install

HarnessTap's Copilot CLI provider runs `copilot plugin install` / `copilot plugin update` against `~/.copilot/installed-plugins/`. You can also install through Copilot directly, then sync:

```bash
copilot plugin install <source>
harnesstap resource sync --overwrite
```

Then re-run `apply` or `mirror` if alias harnesses need refreshed
copies.

## Related scenarios

- [Scenario 31](./scenarios/details/31-dual-mode-plugin-import.md) — import dual-mode plugin repos
- [Scenario 32](./scenarios/details/32-instruction-tier-apply.md) — apply to instruction-tier harnesses
- [Scenario 33](./scenarios/details/33-mirror-plugin-fallback.md) — mirror with plugin-source fallback
- [Scenario 34](./scenarios/details/34-portability-limits.md) — understand portability limits
- [Scenario 39](./scenarios/details/39-mcp-auth-and-environments.md) — MCP auth, environments, account switching
