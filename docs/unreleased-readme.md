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

## docs/cli/concepts/plugins.md > Portable format
<!-- append -->
`plugin.json` `$schema` is `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, the Agent Plugins 1.0.0 identifier. Package export, `ht pack`, and `plugin publish` always write it. Packages that carry the identifier earlier HarnessTap builds wrote (`https://agentplugins.org/schema/v1/plugin.schema.json`) still import: HarnessTap reads them as 1.0.0 and leaves the file as it is. Other `agent-plugins.org` schema versions are rejected as unsupported.
