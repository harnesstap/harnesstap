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

## docs/cli/command-reference.md > plugin (`l`) > Important options
<!-- append -->
- `plugin check` also checks every upstream link (kept-in-sync and separate-copy profiles, and pulled catalog packages) for newer versions and stores the result, so `ht status` and Desktop read the same answer without a network call. `--format json` adds an `upstream` array with `status` of `current`, `update`, `major`, `unreachable` or `unpublished`. A newer major version shows as `major` and is never installed automatically.

## docs/cli/command-reference.md > Project-local verbs > Important options
<!-- append -->
- `status` shows an Updates row when the last upstream check (`plugin check`, or the Desktop sidecar) found newer versions; `status --format json` adds `updates: {count, major_count, items}`. Status reads the stored result and never calls the network.

## docs/cli/concepts/plugins.md > Plugin dependencies and version policy
<!-- append -->
Upstream updates are configured under `updates` in `~/.harnesstap/config.jsonc`:

```jsonc
{
  "updates": {
    "mode": "notify",      // off, notify (default) or install
    "frequency": "daily",  // hourly, daily (default) or weekly
    "prompted": false      // true once the Keep plugins up to date? prompt was answered
  }
}
```

The Desktop sidecar checks upstreams when a check is due under `frequency`, counted from the newest stored check, so restarting the app does not check again. `off` stops remote checks only: synced profiles still follow their parent, and `ht plugin check` still works. `install` also installs, for pulled catalog plugins only, the newest minor or patch inside the caret range. It never installs a major version, a prerelease, or a version outside the range. It skips a plugin whose content no longer matches its published version (local edits), a separate copy, and an update that would rewrite a resource another plugin also uses. The installed version stays as a frozen cut next to the new one. When the active profile uses the plugin, it is re-applied through the normal apply path only if its harness files are clean, and the apply stops on any conflict. One plugin update runs at a time: a scheduled run is skipped while `ht plugin update` or a Desktop Update is running, and `ht plugin update` waits for a scheduled run to finish. `HARNESSTAP_UPDATE_CHECK=off` turns the background schedule off.

## docs/cli/command-reference.md > plugin (`l`) > Important options
<!-- append -->
- `ht plugin auto-update` prints how plugin updates are checked; `--mode off|notify|install` and `--frequency hourly|daily|weekly` change it (stored under `updates` in `~/.harnesstap/config.jsonc`). Install mode installs minor and patch versions inside the range for pulled catalog plugins, never a major. After the first successful `ht plugin update --all` that installs something in an interactive terminal, HarnessTap asks once "Keep plugins up to date?" with the same choices; non-interactive runs never ask.
