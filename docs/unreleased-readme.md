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
