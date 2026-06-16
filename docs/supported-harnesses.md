# Supported harnesses

HarnessDeck registers **33 agent harnesses** today. Each harness declares which **resource types** it can scan, compose in layers, and materialize on disk, plus default **project** and **global** paths. The registry in `src/platforms/registry.ts` is the source of truth; `hd harness list` prints the same set at runtime.

For portability caveats (hooks with `${*_PLUGIN_ROOT}`, OpenCode server plugins, instruction-only skill emission, and mirror warnings), see [Portability limits](portability-limits.md).

## Resource types

HarnessDeck separates **what** (layer/plugin resources) from **how** (environment resources).

### Layer and plugin resources

These are the atomic resources you scan, curate, attach to layers, and re-emit during `layer apply` / `project apply`:

| Type | Description |
| ---- | ----------- |
| **instructions** | Always-on context files (`AGENTS.md`, `CLAUDE.md`, `.windsurfrules`, `.github/copilot-instructions.md`, …) |
| **skills** | `SKILL.md` trees under harness-native skill directories |
| **rules** | Path-scoped or always-on rules (`.cursor/rules/*.mdc`, `.claude/rules/`, `.kiro/steering/`, …) |
| **mcp** | MCP server definitions from harness MCP config files |
| **permissions** | Allow/deny patterns (Claude Code and Codex settings) |
| **hooks** | Hook event definitions from settings or `hooks.json` |
| **agents** | Agent manifest files under harness `agents/` directories |
| **commands** | Static command definitions (markdown, TOML, or manifest pointers) |

**Plugin composition** adds two attachment kinds on top of material resources:

| Attachment | Role |
| ---------- | ---- |
| **plugin** | Lazy link to a marketplace or local plugin (`plugin:name@marketplace`); materializes after `resource sync` or `layer apply --sync-plugins` |
| **layer** | Nested layer reference expanded depth-first at apply time |

### Environment resources

Environments carry **how** values that override matching layer resources during apply (home → layer default → deck active):

| Type | Description |
| ---- | ----------- |
| **env_var** | Plain environment variable key/value pairs |
| **model_config** | Default model and provider selection |
| **permission** | Permission allow/deny overrides |

Only harnesses whose registry entry includes `env_vars`, `model_config`, and/or `permissions` **and** whose native serializer implements those surfaces receive environment values on disk. Today that means **Claude Code** and **Codex** for the full environment trio.

## Plugin manifest layouts

`project scan` and plugin-source import recognize these on-disk plugin trees (in addition to per-harness project files):

| Manifest path | Harness family | Imported as |
| ------------- | -------------- | ----------- |
| `.claude-plugin/plugin.json` | Claude Code | `claude-plugin` |
| `.claude-plugin/marketplace.json` | Claude Code (marketplace root) | `marketplace` |
| `.cursor-plugin/plugin.json` | Cursor | `cursor-plugin` |
| `.cursor-plugin/marketplace.json` | Cursor (marketplace root) | `marketplace` |
| `.codex-plugin/plugin.json` | Codex | `codex-plugin` |
| `.github/plugin/plugin.json` | GitHub Copilot / Copilot CLI | `copilot-plugin` |

Scanning a repo with both harness files and a plugin manifest merges both sources automatically. See [Portability limits — dual-mode scan](portability-limits.md#dual-mode-scan-for-plugin-only-repos).

### Plugin install and sync providers

During `layer apply`, HarnessDeck can **install** and **sync** plugins from host install trees for:

| Harness | Provider | Typical install location |
| ------- | -------- | ------------------------ |
| **claude-code** | Claude Code marketplace / `claude plugin` | `~/.claude/plugins/` |
| **cursor** | Cursor plugin cache (git-backed marketplaces) | `~/.cursor/plugins/` |

Other harnesses still benefit from plugin-source **scan** and **resource sync** when you point at an install tree or plugin repo, but do not have an automated install provider yet.

Claude **layer pins** and marketplace metadata (`layer show` → `claude` block) apply only when materializing to **claude-code**.

## Serializers

| Tier | Harnesses | Notes |
| ---- | --------- | ----- |
| **Native** | `claude-code`, `codex`, `cursor`, `opencode`, `github-copilot`, `copilot-cli`, `gemini-cli` | Dedicated scan/serialize logic |
| **Generic** | All other registered harnesses | Path-driven serializer driven by registry `projectPaths` / `globalPaths` |

Filter native harnesses at the CLI:

```bash
hd harness list --supported
hd harness list --format json
```

## Skill emission modes

Most harnesses emit skills to native skill directories. These harnesses declare `skillEmission: instruction-only` — skills merge into instructions or rules instead of a separate skill tree:

| Harness | Emission target |
| ------- | --------------- |
| **github-copilot** | `.github/copilot-instructions.md` |
| **gemini-cli** | Instruction/rules paths per Gemini serializer |
| **windsurf** | `.windsurf/rules/{name}.md` |
| **cline** | `.clinerules/{name}.md` (or merged rules file) |
| **kiro** | `.kiro/steering/{name}.md` |

**Cursor** additionally honors project `cursor_skill_mode` (`agent-requested`, `always-on`, `agents-skills`). Inspect with `hd harness project status --project . --format json`.

## Agent / subagent bridging

Harnesses with a delegated **subagent** model normalize into a shared canonical shape (`description`, instruction body, `model`, `reasoning_effort`, sandbox/readonly flags) via `src/services/agent-bridge.ts`:

| Harness | Native format | Apply notes |
| ------- | ------------- | ----------- |
| **codex** | `.codex/agents/*.toml` | `developer_instructions`, `model_reasoning_effort`, `sandbox_mode` |
| **claude-code** | `.claude/agents/*.md` + YAML | Richest metadata; extra Claude-only keys preserved in `metadata.extra` |
| **cursor** | `.cursor/agents/*.md` + YAML | `readonly` / `is_background`; `sandbox_mode: read-only` maps to `readonly: true` |
| **opencode**, **github-copilot**, **copilot-cli** | `*/agents/*.md` | Markdown with optional frontmatter |
| **generic** harnesses with `agents:` paths | `*.md` | Same as OpenCode/Copilot emission |

Plugin import scans `agents/*.md` and `agents/*.toml` (Codex packs). Cross-harness layer apply re-emits valid native files per target harness.

## Harness reference

Legend for the **Resources** column: `instr` instructions · `skill` skills · `rule` rules · `mcp` MCP · `perm` permissions · `hook` hooks · `agent` agents · `cmd` commands · `env` env vars · `model` model config.

| ID | Name | Serializer | Resources | Skill emission | Plugin install |
| -- | ---- | ---------- | --------- | -------------- | -------------- |
| `claude-code` | Claude Code | Native | instr, skill, rule, mcp, perm, hook, agent, cmd, env, model | Native skills | Yes |
| `codex` | Codex | Native | instr, skill, rule, mcp, perm, hook, agent, env, model | Native skills | — |
| `cursor` | Cursor | Native | instr, skill, rule, mcp, hook, agent | Native skills | Yes |
| `opencode` | OpenCode | Native | instr, skill, mcp, agent, cmd | Native skills | — |
| `github-copilot` | GitHub Copilot | Native | instr, skill, mcp, agent | Instruction-only | — |
| `copilot-cli` | Copilot CLI | Native | instr, skill, mcp, agent | Native skills | — |
| `gemini-cli` | Gemini CLI | Native | instr, skill, cmd | Instruction-only | — |
| `windsurf` | Windsurf | Generic | instr, skill, rule, mcp | Instruction-only | — |
| `cline` | Cline | Generic | instr, skill, rule, mcp | Instruction-only | — |
| `roo` | Roo Code | Generic | instr, skill, rule, mcp | Native skills | — |
| `continue` | Continue | Generic | instr, skill, mcp | Native skills | — |
| `goose` | Goose | Generic | instr, skill, mcp | Native skills | — |
| `trae` | Trae | Generic | instr, skill, rule, mcp | Native skills | — |
| `openhands` | OpenHands | Generic | instr, skill, mcp | Native skills | — |
| `kiro` | Kiro | Generic | instr, skill, rule | Instruction-only | — |
| `warp` | Warp | Generic | instr, skill | Native skills | — |
| `pi` | Pi | Generic | instr, skill | Native skills | — |
| `amp` | Amp | Generic | instr, skill | Native skills | — |
| `kilo` | Kilo Code | Generic | instr, skill | Native skills | — |
| `augment` | Augment | Generic | instr, skill | Native skills | — |
| `firebender` | Firebender | Generic | instr, skill | Native skills | — |
| `junie` | Junie | Generic | instr, skill | Native skills | — |
| `zencoder` | Zencoder | Generic | instr, skill | Native skills | — |
| `deepagents` | Deep Agents | Generic | instr, skill | Native skills | — |
| `qwen-code` | Qwen Code | Generic | instr, skill | Native skills | — |
| `crush` | Crush | Generic | instr, skill | Native skills | — |
| `droid` | Droid | Generic | instr, skill | Native skills | — |
| `codebuddy` | CodeBuddy | Generic | instr, skill | Native skills | — |
| `mux` | Mux | Generic | instr, skill | Native skills | — |
| `kode` | Kode | Generic | instr, skill | Native skills | — |
| `command-code` | Command Code | Generic | instr, skill | Native skills | — |
| `cortex` | Cortex Code | Generic | instr, skill | Native skills | — |
| `neovate` | Neovate | Generic | instr, skill | Native skills | — |

## On-disk paths (selected harnesses)

These are the primary **project** paths HarnessDeck scans and writes. Global paths follow the same keys under each harness home directory (see `hd harness list --format json`).

| Harness | Instructions | Skills | Rules | MCP | Agents | Commands | Settings |
| ------- | ------------ | ------ | ----- | --- | ------ | -------- | -------- |
| **claude-code** | `CLAUDE.md` | `.claude/skills/` | `.claude/rules/` | `.mcp.json` | `.claude/agents/` | `.claude/commands/` | `.claude/settings.json` |
| **codex** | `AGENTS.md` | `.agents/skills/` | — | `.codex/config.toml` | `.codex/agents/` | — | `.codex/config.toml` |
| **cursor** | `AGENTS.md` (+ legacy `.cursorrules`) | `.agents/skills/` | `.cursor/rules/` | `.cursor/mcp.json` | `.cursor/agents/` | — | — |
| **opencode** | `AGENTS.md` | `.opencode/skills/` | — | `opencode.json` | `.opencode/agents/` | `.opencode/commands/` | — |
| **github-copilot** | `.github/copilot-instructions.md` | `.agents/skills/` | — | (global `~/.copilot/mcp-config.json`) | `.github/agents/` | — | — |
| **copilot-cli** | `AGENTS.md` | `.agents/skills/` | — | `.copilot/mcp-config.json` | `.github/agents/` | — | — |
| **gemini-cli** | `AGENTS.md` | `.agents/skills/` | — | — | — | `commands/` | `gemini-extension.json` |
| **windsurf** | `.windsurfrules` | `.agents/skills/` | `.windsurf/rules/` | (global MCP config) | — | — | — |
| **roo** | `AGENTS.md` | `.roo/skills/` | `.roomodes` | `.roo/mcp.json` | — | — | — |

Generic harnesses in the skills-only tier use harness-specific skill roots such as `.kilocode/skills/`, `.crush/skills/`, or `.factory/skills/` with `AGENTS.md` instructions — see the registry for the full list.

## Related commands

```bash
hd harness list                          # all registered harnesses
hd harness list --supported              # native serializers only
hd harness status                        # global main + alias selection
hd harness project status --project .    # per-project harness prefs + cursor_skill_mode
hd project scan . --dry-run              # detect harnesses and resources in a repo
hd environment list                      # named environments (env vars, models, permissions)
```

## See also

- [Portability limits](portability-limits.md) — fidelity matrix and workarounds
- [CLI command reference](cli/command-reference.md) — full command surface
- [SPEC.md](../SPEC.md) — authoritative product specification
