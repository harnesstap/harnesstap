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
- `plugin publish --strict` blocks when export warnings are present (a renamed skill, a secret moved out of `mcp.json`, or a skipped MCP server). A wrong `$schema` or an unusable `mcp.json` always blocks publish.
- `plugin publish --vendor-extensions` and `migrate export --plugin --vendor-extensions` also write Copilot files under `com.github.copilot/` and Codex hook settings under `extensions["com.openai"]`. The flag is off by default. Existing vendor files are left in place. A hook command that points at a file outside the package is copied next to that hooks file and rewritten to a relative path. A hook whose script cannot be read is left out, with a warning.
- Human `migrate export` prints a path under your home directory as `~/...`. JSON output keeps the absolute path.
- `migrate export --plugin --archive` (or a path ending in `.zip`) writes the Agent Plugins package as a zip. It does not replace a directory.
- A directory whose root `plugin.json` uses the Agent Plugins 1.0.0 `$schema` is an agent plugin. Import keeps `author`, `homepage`, `repository`, and `license`, and keeps vendor namespace objects and their directories (for example `com.openai` and `com.github.copilot`). Path overrides in that manifest are ignored. Root `agents`, `commands`, and `hooks` are still read, with a warning.

## docs/cli/concepts/plugins.md > Plugin dependencies
<!-- append -->
`marketplace add` reads every manifest in the repo: `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`, `.github/plugin/marketplace.json` (Copilot), `.agents/plugins/marketplace.json` (Codex `source.path`, including `./` for the repository root), and a root `marketplace.json`. Each plugin is labeled with that manifest's flavor. When `--platform` is omitted, registry platforms are set from the manifests that were found. Codex stays a catalog flavor and is shown on the plugin row. A plugin root whose `plugin.json` uses the Agent Plugins 1.0.0 `$schema` is classified as an agent plugin. A source path that leaves the repository is omitted, with a warning. `ht resource sync plugin:<name>@<marketplace>` installs that pin. A second sync of the same tree is unchanged. A missing marketplace plugin names that command.

## docs/cli/command-reference.md > apply
<!-- append -->
MCP servers from an Agent Plugins package keep `cwd` and an HTTP transport of `streamable-http` or `sse`. Apply warns when a harness cannot write `cwd`, and when `sse` is written as that harness's HTTP form. `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` stay as written in the library. Import copies the package to `~/.harnesstap/cache/agent-plugins/<plugin>/<version>/` and records a hash for each file it writes. Host MCP configs expand those variables to that directory and to `~/.harnesstap/plugin-data/<plugin>`. A command that starts with `./` is resolved against the package directory and stays one token when the path contains spaces. `cwd` is written for Claude Code, Codex, Copilot, and Grok. Cursor has no `cwd` field, so the command path is absolute and apply warns that the working directory is not written. The plugin data directory is created only when it is missing. HarnessTap records that ownership and leaves an existing unowned directory or file in place. An existing unowned file in the package directory is left in place. Owned files that are replaced or removed are backed up.

Set `harnessSync.nativeAgentPlugins` to `true` to register Agent Plugins packages for Codex and Copilot instead of extracting their skills and MCP servers. The default is off. Codex entries are `[plugins."<name>@harnesstap"]` in `config.toml`. Copilot entries are `enabledPlugins` keys in `.copilot/settings.json`. Other keys stay. Turning a package off removes only those `@harnesstap` keys and the cache files HarnessTap wrote. A config with no `@harnesstap` keys to add or remove is left as it is, including when the flag is on and the profile does not register a package.

## docs/cli/concepts/plugins.md > Plugin dependencies
<!-- append -->
Attaching a marketplace plugin whose source path leaves the repository is rejected. No pin is recorded.

The Cursor and Claude copies of an Agent Plugins package rewrite those variables in the emitted tree only. Cursor writes `${CURSOR_PLUGIN_ROOT}` and an absolute plugin data path. Claude writes `.claude-plugin/plugin.json`, `.mcp.json` (`streamable-http` and `sse` as `http`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`), and copies `com.harnesstap` commands, agents, and hook JSON into the Claude plugin directories. A file HarnessTap does not own inside a Cursor local plugin is left in place. Owned removals are backed up.

## docs/cli/command-reference.md > apply
<!-- append -->
Host MCP configs expand `${PLUGIN_ROOT}`, `${PLUGIN_DATA}`, and `./` commands for an import, a marketplace pin, a git import, and a local install tree. The library copy stays literal.

