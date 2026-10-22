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

## docs/cli/command-reference.md > migrate (`m`) > Important options
<!-- append -->
- `migrate import --strict` / `--no-strict`: a plugin package with files that would not be imported (a `SKILL.md` without frontmatter or with invalid YAML, an invalid `mcp.json` server, root `rules/`, `instructions/` or `mcp-servers/` directories) is refused with every file, its path and the reason, and exit `1`. `--strict` is the default when the terminal is not interactive, with `--format json`, and in CI. On an interactive terminal the import warns and goes ahead; `--no-strict` does the same anywhere. Each plugin import prints imported of discovered resources per type.

## docs/cli/command-reference.md > profile (`p`) > Important options
<!-- append -->
- `profile use <name>` takes the local profile name, the catalog slug, the full catalog ref `org/catalog/slug` (optionally `@version`), or the package display name. When no local profile matches, it pulls the profile from the catalog first. With `--no-pull` or `--dry-run`, or when the catalog lookup or download fails, it stops and prints the exact `ht profile pull` command to run.

## docs/cli/command-reference.md > plugin (`l`) > Important options
<!-- append -->
- `plugin show <name>`, `profile show <name>`, and `plugin doctor <name>` resolve a local plugin the same way as `profile use`: by name or ID, catalog slug, full catalog ref `org/catalog/slug` (optionally `@version`), or package display name. They never pull from the catalog.
- `plugin doctor` re-reads the package a plugin was imported from: the `skipped-files` check fails for each file the import skipped, with its path and reason, and the output lists imported of discovered resources per type (`resource_counts` in JSON)

## docs/cli/command-reference.md > plugin (`l`) > Important options
<!-- append -->
- A git dependency can be pinned. Its constraint takes a full or abbreviated commit SHA (`f8797fe`, or `#f8797fe`), a tag or branch name (`main`, `#main`, `ref:v1.2.0`), or a semver range that resolves to the highest matching tag (`^1.2.0`). Install and apply check out exactly that commit, tag or branch, record the commit on the plugin origin and in the lockfile, and stop with the git error when the ref does not exist. `plugin doctor` accepts these constraints and warns when a git dependency has no pin and tracks the default branch HEAD.
- `plugin add <ref>#<commit, tag or branch>` imports a GitHub `plugin.json` package at that ref (`owner/repo#v1.2.0`, `https://github.com/owner/repo#f8797fe`, `git@github.com:owner/repo.git#main`). `plugin update` keeps the pin: a commit stays put, a branch moves to its new head, and a semver range moves to the highest matching tag.

## Install > npm global
<!-- append -->
`bun x harnesstap@latest` runs the CLI on the Node.js on `PATH`, which must be 22.12 or newer. With an older Node, `bun x --bun harnesstap@latest init` runs it on Bun instead, which needs no native SQLite build.

## docs/cli/getting-started.md > Bun (alternative)
<!-- append -->
`bun x harnesstap@latest` runs the CLI on the Node.js on `PATH`, which must be 22.12 or newer; an older Node stops with one line saying so. Add `--bun` to run it on Bun instead, which needs no native SQLite build:

```bash
bun x --bun harnesstap@latest init
```
