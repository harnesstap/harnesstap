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
