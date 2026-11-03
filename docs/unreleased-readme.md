# Pending README text

`README.md` and the site-rendered docs describe only the latest published release. Text for behaviour that is on `main` but not yet in the latest npm release goes in this file instead. The Tag release workflow folds it into the target files (`scripts/fold-unreleased-readme.ts`) and then empties this file back to this header. Write in the present tense with no version references (version-gated notes fail the G7 guard).

Format. One level-2 section per target. The heading names where the text goes, and the first line of the body is a mode marker. Both are required; a section without a marker fails the fold and G7 with an error naming the section.

```markdown
## Install
<!-- replace -->
New text for the Install section of README.md.

## docs/cli/command-reference.md > plugin (`l`) > Important options
<!-- append -->
- `plugin list --remote` adds catalog results.
```

- Heading: `## <heading text>` targets a heading in `README.md`. `## <path>.md > <heading text>` targets another file; the path must be `README.md` or a page under `docs/`. Chain parent headings with ` > ` to disambiguate repeated headings such as `Commands` (the target must match exactly one heading). Heading text is compared exactly, including backticks.
- `<!-- replace -->` replaces the target's text (everything under the heading up to the next heading or `---` rule).
- `<!-- append -->` adds the body after the target's existing text.
- `<!-- insert-after -->` adds a whole new section after the target section ends (its subsections included). The body may contain headings, written at `###` or deeper; the fold shifts them so the shallowest becomes the target's own level.
- Only `insert-after` bodies may contain headings. Do not use level-1 or level-2 headings inside a body.

## Install > Recommended: npx (no global install)
<!-- insert-after -->
### Homebrew (macOS and Linux)

```bash
brew install harnesstap/tap/harnesstap
ht init
```

The formula installs the npm package on Homebrew's `node@24`, so you do not need your own Node.js. Upgrade with `brew upgrade harnesstap`; the CLI update notice suggests that command for Homebrew installs.

## Desktop
<!-- append -->
On macOS you can also install Desktop with Homebrew:

```bash
brew install --cask harnesstap/tap/harnesstap-desktop
```

The cask installs the same unsigned DMG, so the first launch still needs **Open Anyway** under System Settings > Privacy & Security.

## docs/supported-harnesses.md > On-disk paths (selected harnesses) > MiniMax Code notes
<!-- insert-after -->
### MCP, rules, and hooks for Gemini CLI, Kiro, Zed, Droid, and GitHub Copilot

| Harness | MCP file (project / global) | Key | Other |
|---|---|---|---|
| **gemini-cli** | `.gemini/settings.json` / `~/.gemini/settings.json` | `mcpServers` | Tool filters become `includeTools` and `excludeTools` |
| **kiro** | `.kiro/settings/mcp.json` / `~/.kiro/settings/mcp.json` | `mcpServers` | Skills in `.kiro/skills/` (`.agents/skills/` is still scanned); hooks as one file each in `.kiro/hooks/` |
| **zed** | `.zed/settings.json` / `~/.config/zed/settings.json` | `context_servers` | Zed runs project servers only in a trusted worktree |
| **droid** | `.factory/mcp.json` / `~/.factory/mcp.json` | `mcpServers` | Entries carry `type` (`stdio` or `http`) |
| **github-copilot** | (unchanged) | | Rules become `.github/instructions/<name>.instructions.md` with `applyTo` globs |

These files are shared with the harness. HarnessTap merges only the servers it manages, keeps every other key, and on removal takes out only its own entries. MCP servers can set `enabled_tools` (allow list) and `disabled_tools` (deny list); Codex writes both, Gemini CLI writes `includeTools` and `excludeTools`, Kiro and Droid write `disabledTools`, and Copilot uses `enabled_tools` as its `tools` list.

Kiro hooks: `Stop`, `SessionStart`, `SessionEnd`, and `PreToolUse` or `PostToolUse` hooks that match every tool are written. Hooks for other events, or tool hooks with a specific matcher, are not written for Kiro, because Kiro tool IDs differ from other harnesses' tool names.

## docs/supported-harnesses.md > On-disk paths (selected harnesses)
<!-- replace -->
These are the primary **project** paths HarnessTap scans and writes. Global paths follow the same keys under each harness home directory (see `ht harness list --format json`).

| Harness | Instructions | Skills | Rules | MCP | Agents | Commands | Settings |
| ------- | ------------ | ------ | ----- | --- | ------ | -------- | -------- |
| **claude-code** | `CLAUDE.md` | `.claude/skills/` | `.claude/rules/` | `.mcp.json` (project); `~/.claude.json` (user); local `projects[]` inventory-only | `.claude/agents/` | `.claude/commands/` | `.claude/settings.json` |
| **codex** | `AGENTS.md` | `.agents/skills/` |: | `.codex/config.toml` | `.codex/agents/` | `.codex/prompts/` | `.codex/config.toml` |
| **cursor** | `AGENTS.md` (+ legacy `.cursorrules`) | `.agents/skills/` | `.cursor/rules/` | `.cursor/mcp.json` | `.cursor/agents/` |: |: |
| **opencode** | `AGENTS.md` | `.opencode/skills/` (also reads `.agents/skills/`, `.claude/skills/`) |: | `opencode.json` | `.opencode/agents/` (also `.opencode/agent/`) | `.opencode/commands/` (also `.opencode/command/`) |: |
| **github-copilot** | `.github/copilot-instructions.md` | `.agents/skills/` |: | (global `~/.copilot/mcp-config.json`) | `.github/agents/` |: |: |
| **copilot-cli** | `AGENTS.md` | `.agents/skills/` |: | `.copilot/mcp-config.json` | `.github/agents/` |: |: |
| **gemini-cli** | `AGENTS.md` | `.agents/skills/` |: |: |: | `commands/` | `gemini-extension.json` |
| **antigravity** | `AGENTS.md` (+ `GEMINI.md`) | `.agents/skills/` | `.agents/rules/` (with `trigger` frontmatter) | `.agents/mcp_config.json` |: | `.agents/skills/` (written as skills) |: |
| **amazon-q** | `AmazonQ.md` (+ `AGENTS.md`) |: | `.amazonq/rules/` | `.amazonq/mcp.json` |: |: |: |
| **windsurf** | `.windsurfrules` | `.agents/skills/` | `.windsurf/rules/` | (global MCP config) |: |: |: |
| **roo** | `AGENTS.md` | `.roo/skills/` | `.roo/rules/` | `.roo/mcp.json` |: |: |: |
| **goose** | `AGENTS.md`, `.goosehints` | `.agents/skills/` (+ `.goose/skills/`) |: | `.config/goose/config.yaml` (project), `~/.config/goose/config.yaml` (global) |: | `recipes/*.yaml` | `~/.config/goose/config.yaml` |
| **aider** | `CONVENTIONS.md` (+ `AGENTS.md`) |: |: |: |: |: | `.aider.conf.yml` |
| **zed** | `AGENTS.md` (+ `.rules`) | `.agents/skills/` |: |: |: |: |: |
| **devin** | `AGENTS.md` (+ `AGENTS.local.md`) | `.agents/skills/` |: |: |: |: | `.devin/config.json` |
| **grok-build** | `AGENTS.md` (+ `AGENT.md`) | `.grok/skills/` (also reads `.agents/skills/`, `.claude/skills/`) |: | `.grok/config.toml` | `.grok/agents/` | `.agents/commands/` | `.grok/config.toml` |
| **deepseek-harness** | `AGENTS.md` (+ `CLAUDE.md`) | `.dsh/skills/` |: | `~/.dsh/cordis.patch.yml` (global) | `~/.dsh/.agent-presets/` |: | `~/.dsh/settings.yaml` |
| **muse-code** | `AGENTS.md` (also reads `CLAUDE.md`, `.agents/AGENTS.md`, `.claude/CLAUDE.md`) | `.agents/skills/` |: | `~/.config/muse/settings.json` (`mcp_servers`, global only) |: |: | `~/.config/muse/settings.json` |
| **minimax-code** | `AGENTS.md` (also reads `CLAUDE.md`, `.agents/AGENTS.md`) | `.minimax/skills/` (also reads `.agents/skills/`, `.claude/skills/`) |: | project `.mcp.json`; user `~/.minimax/mcp.json` |: |: | `~/.minimax/config.yaml` (not rewritten) |
| **cody** | `AGENTS.md` |: |: | (global `~/.config/sourcegraph/cody.json`) |: |: | `cody.json` |

Claude Code **user** MCP lives in `~/.claude.json` (`mcpServers` at the top level). Global apply merge-overlays that key and leaves OAuth session and `projects` (local-scope MCP, trust) untouched. **Project** MCP remains `.mcp.json`. **Local** MCP (`projects[<absPath>].mcpServers`) is scanned for inventory with source `~/.claude.json#local:<absPath>` and is never applied. See [Portability limits: Claude Code MCP scopes](portability-limits.md#claude-code-mcp-scopes).

Cursor global user skills live under `~/.cursor/skills/`. Cursor also maintains app-managed built-ins under `~/.cursor/skills-cursor/`: HarnessTap inventories those on `profile status` / apply-preview (`host_managed.cursor`) and on Desktop **Harnesses** (app-managed panel) but never imports, applies, discards, or removes them from disk. Cursor plugin installs live under `~/.cursor/plugins/` and are listed only when Cursor's own install records say they are installed. When third-party Plugins/Skills/configs are enabled, Desktop Harnesses also lists related trees Cursor can read: Claude `~/.claude/plugins/` and `~/.claude/skills/`, plus the shared `~/.agents/skills/` hub. When that setting is off, those foreign trees are omitted from the Cursor harness.

Copilot CLI home state lives under `~/.copilot/`. Detection uses `~/.copilot/settings.json` and `~/.copilot/installed-plugins/` in addition to `~/.copilot/skills/` and `~/.copilot/mcp-config.json`. Installed plugins are imported as pins from `~/.copilot/installed-plugins/<marketplace>/<plugin>/`.

Generic harnesses in the skills-only tier use harness-specific skill roots such as `.kilocode/skills/`, `.crush/skills/`, or `.factory/skills/` with `AGENTS.md` instructions: see the registry for the full list.

Cursor plugin directories under `~/.cursor/plugins/cache`, `marketplaces/`, and `local/` count as installed, including when Cursor has the plugin turned off. `plugin-*` MCP folders count as installed too. A folder is matched to the plugin named in its manifest or under `~/.cursor/plugins/cache/<marketplace>/<plugin>/<version>`, and that plugin is not listed a second time. Status does not read `state.vscdb` or the Cursor logs folder. A HarnessTap database write that changes a profile is included in the next status. Adding a library resource that no profile uses does not refresh status. Whether Cursor loads other harness trees is read from `settings.json` only, and defaults to on.

## docs/supported-harnesses.md > On-disk paths (selected harnesses) > Antigravity notes
<!-- replace -->
Antigravity IDE, Antigravity CLI (`agy`), and AGY share the same workspace layout under `.agents/`. Antigravity no longer reads workflows, so HarnessTap writes **commands** as skills (`.agents/skills/<name>/SKILL.md`, global `~/.gemini/skills/`); a skill with the same name wins. Existing `.agents/workflows/` and `~/.gemini/config/global_workflows/` files are still scanned as commands. On apply, workflow files HarnessTap wrote are backed up and removed, and files it did not write are kept with a warning (Antigravity's `/migrate-workflows` converts them). Rules in `.agents/rules/` carry the required `trigger` frontmatter: `glob` with `globs` when the rule has globs, `always_on` for always-apply rules, `model_decision` for rules with a description, and `manual` otherwise. Global config lives under `~/.gemini/` (`GEMINI.md`, `config/mcp_config.json`, `skills/`). This is distinct from the thinner `gemini-cli` entry.

Roo rules are plain files in `.roo/rules/`, one per rule. HarnessTap no longer writes rules into `.roomodes`. On apply, a `.roomodes` HarnessTap wrote is backed up and removed. In a `.roomodes` you also edited, only the `## <rule>` sections that still match what HarnessTap wrote are removed; everything else, including text you added under one of those sections, is kept with a warning.
