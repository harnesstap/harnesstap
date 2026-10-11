# Pending README text

Park README text for behaviour that is on `main` but not yet in the latest published npm release here, not in `README.md`. The release flow folds this file into `README.md` and then empties it (`scripts/fold-unreleased-readme.ts`, run by the Tag release workflow).

Format: one `## <README heading text>` section per target, matched to exactly one heading in `README.md` at any level. The first line of the body must be `<!-- append -->` (add after the existing section text) or `<!-- replace -->` (replace the whole section text up to the next heading or `---` rule). Write in the present tense with no version references. Section bodies cannot contain headings.

## Project: scan and apply

<!-- replace -->

```bash
ht init --harnesses codex,claude-code,cursor
ht scan .
ht resource list
ht apply engineering-foundation --project .
ht status .
```

`ht apply engineering-foundation` resolves the public catalog when the plugin is not already local. When the repository has a git `origin`, apply stores a snapshot first; restore with `ht revert`.

## Machine: profile switch

<!-- replace -->

```bash
ht init --harnesses claude-code,cursor,codex
ht profile use "global default"
# after you compose a `work` profile:
ht work
```

`init` seeds a `global default` profile plugin. It does **not** write home harness files until you run `profile use` (or the `ht <name>` shorthand; `ht default` still resolves to `global default`).

More install and follow-up recipes: [Getting started](docs/cli/getting-started.md).

## Demo

<!-- replace -->

Initialise HarnessTap, scan an existing repository, browse catalog plugins, apply one, and confirm the final state, all in about a minute.

[![Existing repo adoption walkthrough](docs/scenarios/vhs/output/01-existing-repo-adoption.gif)](docs/scenarios/vhs/walkthroughs/01-existing-repo-adoption.md)

[Full walkthrough →](docs/scenarios/vhs/walkthroughs/01-existing-repo-adoption.md)

```bash
ht init --harnesses codex,claude-code,cursor
ht scan .                    # detect existing resources
ht resource list             # review discovered resources
ht plugin list --search foundation --remote-only
ht apply engineering-foundation --project .
ht status .                  # confirm the final state
```

## Catalog and Cloud

<!-- append -->

Private GitHub marketplaces: `ht github login`.

## Supported harnesses

<!-- replace -->

```bash
ht harness list
ht harness list --supported    # native serializers only
ht harness set --harnesses claude-code,cursor,codex
```

See the full matrix (resource types, skill emission, plugin support, and paths) in **[Supported harnesses](docs/supported-harnesses.md)**.

## Where data lives

<!-- append -->

GitHub session: `~/.harnesstap/github-session.json`.
