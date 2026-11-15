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

## docs/supported-harnesses.md > MCP, rules, and hooks for Gemini CLI, Kiro, Zed, Droid, and GitHub Copilot
<!-- append -->
GitHub Copilot and Copilot CLI read workspace MCP servers from `.mcp.json` at the project root, so HarnessTap writes project MCP servers for both there (this replaces the `.copilot/mcp-config.json` and "unchanged" entries in the tables above). Each entry carries `type` (`stdio`, `http`, or `sse`); `tools` is written only for an `enabled_tools` allow list, because Copilot enables every tool when it is missing. `.mcp.json` is shared with Claude Code: HarnessTap merges only its own servers and keeps the rest. Scans also read `.github/mcp.json` and the project `.copilot/mcp-config.json` that earlier applies wrote; the next apply moves those servers into `.mcp.json` and removes the old file only when it is unchanged, with a backup. The user file `~/.copilot/mcp-config.json` is unchanged.

## docs/supported-harnesses.md > Antigravity notes
<!-- insert-after -->
### Windsurf (Devin Local) and Devin notes

Windsurf is now Devin Desktop, and its Devin Local agent uses the Devin CLI layout. For both `windsurf` and `devin` (this replaces their rows in the table above):

| Surface | Project | Global |
|---|---|---|
| Rules | `.devin/rules/<name>.md` with `trigger` frontmatter (`always_on`, `manual`, `model_decision`, `glob`) | `~/.devin/rules/` |
| Skills | `.agents/skills/<name>/SKILL.md` | `~/.agents/skills/` |
| MCP | `.devin/mcp_config.json` (`mcpServers`) | `~/.config/devin/mcp_config.json` |

Windsurf instructions stay in `.windsurfrules`, which Devin Local still imports, and Windsurf skills are written as skill folders instead of rules. MCP files are shared with Devin: HarnessTap merges only the servers it manages and keeps every other key. Entries use `command`, `args`, and `env`, or `url` and `headers`; SSE servers add `transport: "sse"`, and `disabled_tools` becomes `disabledTools`. Scans also read `.windsurf/rules/`, `.devin/skills/`, `~/.config/devin/skills/`, `~/.codeium/windsurf/skills/`, `~/.codeium/windsurf/mcp_config.json`, and servers still listed in Devin `config.json`; servers from those older MCP files are written to the current one on the next apply. Files earlier applies wrote to `.windsurf/rules/` are removed only when unchanged, with a backup.

## docs/scenarios/details/32-instruction-tier-apply.md > Scenario 32: Apply to instruction-tier harnesses
<!-- replace -->
**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when applying a plugin to harnesses that load skills as **always-on
instructions or rules** rather than agent-requested skill directories. Harnesses
with registry `skillEmission: instruction-only` include `cline`,
`github-copilot`, and `gemini-cli`.

Typical commands:

```bash
# Preview per-harness output paths
harnesstap apply my-setup --project . --harness cline,github-copilot --dry-run

# Apply to instruction-tier harnesses alongside native-skill hosts
harnesstap apply my-setup --project . --harness claude-code,codex,cline,cursor

# List all harnesses; instruction-tier hosts have skillEmission: instruction-only
harnesstap harness list --format json
```

**Expected emission paths** (instruction-tier hosts):

| Harness | Skills become |
| ------- | ------------- |
| `cline` | `.clinerules/{name}.md` (or merged rules file) |
| `github-copilot` | Sections in `.github/copilot-instructions.md` |
| `gemini-cli` | Rules/instructions per Gemini serializer paths |

Native-skill hosts (`claude-code`, `codex`, `cursor` with default mode,
`windsurf`, `kiro`, etc.) continue to emit `.claude/skills/`, `.agents/skills/`,
or harness-specific skill directories such as `.kiro/skills/`.
