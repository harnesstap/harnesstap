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

## docs/cli/command-reference.md > plugin (`l`) > Commands
<!-- append -->
- `plugin validate <file>` - load an Agent Plugins directory, zip, or `.ap.json` and report skills, MCP servers, skipped entries, and ignored manifest fields (`--spec 1.0.0`, `--format json`)
- A directory whose root `plugin.json` uses the Agent Plugins 1.0.0 `$schema` is an agent plugin. Import keeps `author`, `homepage`, `repository`, and `license`, and keeps vendor namespace objects and their directories (for example `com.openai` and `com.github.copilot`). Path overrides in that manifest are ignored. Root `agents`, `commands`, and `hooks` are still read, with a warning.

## docs/cli/command-reference.md > apply
<!-- append -->
MCP servers from an Agent Plugins package keep `cwd` and an HTTP transport of `streamable-http` or `sse`. Apply warns when a harness cannot write `cwd`, and when `sse` is written as that harness's HTTP form. `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` stay as written in the library. The plugin data directory is `~/.harnesstap/plugin-data/<plugin>`. HarnessTap creates it only when it is missing, records that ownership, and leaves an existing unowned directory or file in place.

The Cursor and Claude copies of an Agent Plugins package rewrite those variables in the emitted tree only. Cursor writes `${CURSOR_PLUGIN_ROOT}` and an absolute plugin data path. Claude writes `.claude-plugin/plugin.json`, `.mcp.json` (`streamable-http` and `sse` as `http`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`), and copies `com.harnesstap` commands, agents, and hook JSON into the Claude plugin directories. A file HarnessTap does not own inside a Cursor local plugin is left in place. Owned removals are backed up.
