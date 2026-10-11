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

## Install

<!-- replace -->

**Requirements:** Node.js 22.12+ or 24 to run the published CLI.

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

## docs/cli/command-reference.md > Global options

<!-- replace -->

Available on `harnesstap` / `ht`:

- `-V, --version` prints the HarnessTap CLI version (`--harnesstap-version` is a hidden alias)
- `-v, --verbose` - show verbose error output
- `--no-color` - disable ANSI colors
- `--no-interactive` - disable interactive prompts
- `-h, --help` - show help

## docs/cli/command-reference.md > init

<!-- replace -->

Initialize local HarnessTap state.

```bash
ht init
ht init --harnesses claude-code,cursor,codex
ht init --format json
```

Key options:

- `--harnesses <slugs>` - comma-separated registered harness slugs
- `--main <slug>` / `--aliases <slugs>` - deprecated; prepended/appended to the registered set
- `--no-default-profile` - skip seeding the `global default` profile plugin and `active-profile.json` pointer
- `--interactive` - prompt for harness selection instead of relying on explicit flags
- `--format <mode>` - `human` or `json`

`init` seeds a local `global default` profile plugin (tagged `profile`) from library resources imported from home **only when no profile plugins exist yet**. Re-running init or starting Desktop does not recreate `global default` after a rename or when other profiles are present. It writes `active-profile.json` when that profile is created or the pointer is unset (unless `--no-default-profile`), and prints the tracked directory list (home as `~`). Global apply does **not** run automatically - run `ht profile use "global default"` to materialize home harness files.

## docs/cli/command-reference.md > Project-local verbs > Commands

<!-- replace -->

- `scan [path]` - import resources from a project tree (hash-aware upsert; prompts on content drift when interactive)
- `use` - switch to a project-configured profile from `apm.yml` (`ht use --profile <key>`, not a positional profile name)
- `mirror [path]` - rematerialize other registered harnesses from `--from` (default first registered)
- `status [path]` - show project status with drift summary
- `history [path]` - list snapshots for a tracked project
- `revert [snapshot-id]` - restore files from a previous snapshot

Apply plugins with top-level `apply` (not under this group). Onboard from repo-root `apm.yml` with top-level `install` (the same loop as `apply` with no plugin selector). Preview resolved apply targets with `targets`; `compile` is the same apply-from-manifest loop under a named entry.

## docs/cli/command-reference.md > Project-local verbs > Important options

<!-- replace -->

- `scan --harness <slug>` - scan only one harness
- `scan --dry-run` - preview imports without writing to the DB
- `scan --overwrite` - replace library rows when scan content differs
- `scan --skip-existing` - keep existing rows when scan content differs
- `scan --namespace <name>` - namespace for imported project resources (default: `project`; home scan stays empty / global)
- `scan --global` - install imported plugin sources into global harness locations
- `scan --harness <slugs>` - harness targets for `--global` plugin installs
- `use --profile <key>` - profile key from `apm.yml` (required unless `--list`)
- `use --list` - list profiles from project config without applying
- `use --dry-run` - preview global apply without writing
- `use --force` - apply even when the profile is already active and in sync
- `use --no-pull` - fail when composition refs are missing locally
- `use --harness <slugs>` / `--on-conflict <replace|skip|prompt|cancel>` / `--account <name>` / `--base-url <url>` / `--format json`
- `mirror --dry-run` - preview rematerialize writes
- `mirror --from <slug>` - on-disk harness to copy from (`--force-shift-reference` is a deprecated alias)
- `mirror --reference <strategy>` - reference source: disk, plugin, agents, auto (`main` is a deprecated alias of disk)
- `mirror --format json`
- `status --check` - exit `1` when drift exists since the last snapshot, or when `apm.lock.yaml` disagrees with the applied manifest (CI)
- `status --format json` - includes a `drift` object when git-backed
- `history --format json`
- `history --show-id` - show full snapshot IDs in human tables

## docs/cli/command-reference.md > plugin (`l`) > Commands

<!-- replace -->

- `plugin create <name>`
- `plugin list` - local plugins plus streamed remote catalog plugins (default); use `--local-only` for local plugins only
- `plugin show <name>`
- `plugin editor [name]` - open a plugin definition file in your system editor
- `plugin search [query]` - search marketplace catalogs for plugins (name, tags, plugin.json, nested skills/commands)
- `plugin add <ref>` - import a GitHub `plugin.json` package into the library (`https://github.com/owner/repo`, `owner/repo`, or `gh:owner/repo`)
- `plugin add <ref> --to <plugin>` - add a dependency to a plugin (`ref`: local name, `org/catalog/name`, `name@marketplace`, or git URL)
- `plugin edit [name]` - interactively add/remove attachments, set default environment, or script changes with `--add` / `--remove` / `--apply` / `--environment` / `--clear-environment`
- `plugin delete [name]`
- Prefer top-level `apply [plugin...]` (see above). The old `plugin apply` / `l apply` spelling was removed when apply moved to the root.
- `plugin cut <plugin> --version <semver>` - cut a new local version from the working head
- `plugin versions <plugin>` - list local versions (head + frozen)
- `plugin rollback <plugin> --to <semver>` - copy a frozen version onto the working head
- `plugin fork <plugin>` - copy an upstream or catalog plugin into an editable authored plugin (default name `<plugin>-fork`; local authored plugins cannot be forked)
- `plugin pull <selector>` - download a remote plugin bundle and import it
- `plugin catalog list` - show default catalog, connected orgs/libraries, registered publish catalogs, and cloud base URL
- `plugin catalog` - interactive publish-binding wizard (plugin picker → catalog checkboxes)
- `plugin catalog bindings [plugin]` - show effective publish targets (non-TTY) or edit bindings (`--add`, `--remove`, `--clear`; `--add` replaces the full allow list)
- `plugin catalog register org/catalog` - register a publish destination
- `plugin catalog unregister org/catalog` - remove a publish destination from the registry
- `plugin catalog registered` - list registered publish catalogs
- `plugin catalog connect org <slug>` - opt into another org's public libraries (saves the org even when it currently has no public plugins; warns, exit 0)
- `plugin catalog disconnect org <slug>`
- `plugin catalog connect plugin <org>/<slug>` or `<org>/<catalog>/<slug>` - opt into a single public library
- `plugin catalog disconnect plugin <org>/<slug>` or `<org>/<catalog>/<slug>`
- `plugin publish <plugin>` - export bundle and upload to all effective publish targets (registered catalogs, or per-plugin allow list)
- `plugin publish plan <plugin>` - dry-run: list effective targets and planned versions
- `plugin diff <left> <right>`
- `plugin doctor [name]` - validate a plugin without writing to disk
- `plugin check [name]` - compare library working heads to marketplace, git, and catalog origins
- `plugin update [name]` - update a working head from origin (`--all` for every outdated syncable head)
- `plugin why <target>` - explain why a version was selected or which plugin won a resource (`skill:name`, plugin name)
- `plugin from-project [name] --project <path>`

## docs/cli/command-reference.md > plugin (`l`) > Important options

<!-- replace -->

- `plugin create -d, --description <text>` - plugin description
- `plugin create --tags <tags>` - comma-separated tags
- `plugin create --version <semver>` - plugin version (default `1.0.0`)
- `plugin create --from <source>` - import a skill package (`owner/repo`, git URL, or local path) and attach selected skills
- `plugin create --skill <names>` - comma-separated skills to attach when using `--from`
- `plugin create --all` - attach all discovered skills when using `--from`
- `plugin create --exclude-category <names>` - exclude skill categories (repeatable or comma-separated)
- `plugin create --on-conflict <policy>` - when the plugin exists: `replace`, `skip`, `prompt` or `cancel` (default `cancel`). `merge` is plugin import only. Aliases for one release: `overwrite` -> `replace`, `ignore` -> `skip`, `fail` -> `cancel`.
- `plugin create --install` - opt-in hub install; requires `--global` or `--project`
- `plugin create --dry-run` - preview configuration without writing
- `plugin list --format json`
- `plugin list --show-id`
- `plugin list -s, --search <query>` - filter local and remote plugins by name, description, or tags
- `plugin list --local-only` - list only local plugins
- `plugin list --remote-only` - skip local section; remote-only JSON emits a top-level array
- `plugin list --tag <tag>` - filter remote catalog plugins by tag
- `plugin list --account <name>` / `--base-url <url>` - cloud account and base URL for remote listing
- `plugin list --no-interactive` - disable TTY browse wizard (streaming print-only)

See [Interactive list keyboard reference](interactive-ux.md) for TTY browse/search shortcuts.

- `plugin show --format json`
- `plugin editor --format json`
- `plugin search --refresh` - refresh marketplace catalogs before searching
- `plugin search --plugin <name>` - attach the selected plugin pin to this plugin (interactive browse picker on TTY)
- `plugin search --format json` / `--no-interactive`
- `plugin add --to <plugin>` - required when `ref` is not a GitHub plugin source (deprecated `--layer` alias)
- `plugin add --format json`
- `plugin edit --type <type>` - restrict tables to one attachment type
- `plugin edit --search <query>` - pre-fill the interactive search filter
- `plugin edit --show-id`
- `plugin edit --all` - show every resource per type (default caps at 10)
- `plugin edit --dry-run` - preview membership changes without writing
- `plugin edit --format json --no-interactive` - read-only membership snapshot
- `plugin edit --add <selector>` - add attachment (repeatable; use `--type` when selector omits prefix). Plugin dependencies use `plugin:ref@source` (marketplace, local path, git URL, or `org/catalog/name`); legacy `plugin_pin:` / `plugin:` still resolve with a notice
- `plugin edit --remove <selector>` - remove attachment (repeatable)
- `plugin edit --apply <file.json>` - apply membership from JSON spec
- `plugin edit --version <constraint>` - plugin dependencies only (scripting adds)
- `plugin edit --sync` - sync an upstream plugin immediately after add (default: lazy)
- `plugin edit --embed` - mark plugin dependency as embed-on-export when adding
- `plugin edit --environment <name>` - bind a default environment to the configured plugin that `apply` resolves
- `plugin edit --clear-environment` - clear the configured plugin default environment
- `apply --project <path>` - target project directory (default `.`)
- `apply --target <slugs>` / `--all` / `--harness <slugs>` - APM target slugs or HarnessTap harness slugs (same resolution slot)
- `apply --on-conflict <replace|skip|prompt|cancel>` - what to do when it already exists. Non-interactive apply still falls back to `replace` today; DS-6 default is `cancel` (W2-12). Aliases: `overwrite` -> `replace`, `ignore` -> `skip`, `fail` -> `cancel`.
- `apply --dry-run` - show planned file writes only
- `apply --explain` - print the resolution trail (selected versions and every resource decision)
- `apply --update` - ignore `apm.lock.yaml` and re-resolve the dependency graph (including git `dependencies.apm` refs)
- `apply --strict-plugin-versions` / `--ignore-plugin-versions` / `--sync-plugins`
- `plugin why --project <path>` - project with the lockfile to inspect (default `.`)
- `plugin why --root <plugin>` - resolve against this root instead of the lockfile root
- `plugin why --format json`
- `plugin cut --version <semver>` - required new version (must differ from the current head)
- `plugin cut --format json`
- `plugin versions --format json`
- `plugin rollback --to <semver>` - frozen version to copy onto the working head
- `plugin rollback --yes` - skip confirm (required when non-interactive)
- `plugin fork --as <name>` - name for the authored fork (default `<plugin>-fork`)
- `plugin fork --format json`
- `plugin diff --format json`
- `plugin doctor --check <name>` - run one check (repeatable)
- `plugin doctor --list-checks` - list available checks
- `plugin doctor --format json` - exits `1` when the plugin is invalid
- `plugin check --refresh` - force-fetch origins (otherwise check may use the marketplace refresh cache)
- `plugin check --format json` - same rows as the human table; exits `1` when any row is `error`
- `plugin update --all` - update every outdated syncable working head
- `plugin update --force` - reapply even when fingerprints match
- `plugin update --yes` - skip `--all` confirmation (required off-TTY)
- `plugin update --format json` - exits `1` when any row is `failed`
- `plugin from-project -d, --description <text>`
- `plugin from-project --harness <slug>`
- `plugin pull --as <name>`
- `plugin pull --org <slug>`
- `plugin pull --catalog <slug>` - catalog slug when selector omits catalog (default `default`)
- `plugin pull --version <constraint>`
- `plugin pull --account <name>`
- `plugin pull --base-url <url>`
- `plugin publish org/catalog` - one-off publish to a single catalog (does not change bindings)
- `plugin publish --org <slug> --catalog <slug>` - one-off override (same as positional `org/catalog`)
- `plugin publish --account <name>`
- `plugin catalog bindings --add org/catalog` - replace per-plugin allow list (repeatable; auto-registers missing catalogs)
- `plugin catalog bindings --remove org/catalog` - remove one target from the allow list
- `plugin catalog bindings --clear` - revert plugin to all registered catalogs
- `plugin catalog register --account <name>` - optional account for a registered catalog

`plugin pull` and `plugin list` remote discovery query catalog scope **plus** registered publish catalogs (`plugin catalog register`). Use `plugin catalog connect` to add other public orgs or libraries explicitly. Register publish destinations with `plugin catalog register` before `plugin publish` when no bindings exist. `plugin pull` fails on local name conflict instead of overwriting. `apply` resolves bare catalog names at apply time; use `plugin pull` to install plugins for offline reuse. Apply resolves nested plugin dependencies as a graph (nearest-to-root resource precedence; equal-depth set-like types use declaration order with a warning).

## docs/cli/command-reference.md > profile (`p`) > Important options

<!-- replace -->

- `profile list --format json`
- `profile list -s, --search <query>` - filter local and remote profile plugins
- `profile list --local-only` - list only local profile plugins
- `profile list --remote-only` - skip local section
- `profile list --account <name>` / `--base-url <url>` / `--no-interactive`
- `profile show --format json`
- `profile show --show-id`
- `profile status --check` - exit 1 when global state is out of sync
- `profile status --harness <slugs>` / `--format json`
- `profile create -d, --description <text>`
- `profile create --from <source>` - same skill-package options as `plugin create --from`
- `profile create --use` - apply globally and set active after create/promote
- `profile create --use --dry-run` - preview global apply
- `profile create -y, --yes` - skip the interactive enable prompt
- `profile delete --plugin` - also delete the underlying plugin without prompting
- `profile delete -y, --yes` - skip the interactive plugin delete prompt
- `profile use --profile <key>` - profile key from `apm.yml` (delegates to project config when set)
- `profile use --project <path>` - project directory for `apm.yml` discovery (default `.`)
- `profile use --force` - apply even when the profile is already active and in sync
- `profile use --dry-run` - preview global file writes
- `profile use --harness <slugs>` - comma-separated harness slugs (default: global harness preference)
- `profile use --on-conflict <replace|skip|prompt|cancel>`
- `profile use --account <name>` - cloud account for auto-pull of missing published dependencies
- `profile use --base-url <url>`
- `profile use --no-pull` - fail when composition refs are missing locally
- `profile use --format json`
- `profile pull` - same flags as `plugin pull` (`--as`, `--org`, `--catalog`, `--version`, `--account`, `--base-url`)
- `profile publish --org <slug>` / `--catalog <slug>` / `--account <name>` / `--format json`
- `profile preview --scope <home|project|both>` - preview scope (default `home`)
- `profile preview --project <path>` / `--harness <slugs>` / `--format json`
- `profile switch` - same apply flags as `profile use` (`--dry-run`, `--harness`, `--on-conflict`, `--no-pull`, `--account`, `--base-url`, `--format json`)
- `profile stash` - `--dry-run`, `--harness`, `--on-conflict`, `--format json`
- `profile stash pop` / `profile stash apply` - same pull/apply flags as `profile use`
- `profile add-resource <name> --selector <type:name> --scope <home|project>` - adopt one untracked on-disk resource
- `profile add-all-resources <name> --scope <home|project>` - adopt every untracked material resource in the scope
- `profile commit-resource <name> --path <path>` or `--selector <type:name>` - snapshot live disk into the profile library (skills as 1:1 files; MCP, settings, and hooks JSON as all resources in that file)
- `profile remove-resource <name> --selector <type:name>` - detach a material resource from the profile stack
- `profile restore-file <name> --path <path>` - overwrite the live managed file with the profile snapshot
- `profile file-diff <name> --path <path>` - unified diff of live content vs after-apply snapshot

`profile use` auto-pulls missing published `plugin` composition refs by default. If the profile plugin defines `default_environment_id`, the home active environment pointer is updated on switch.

## docs/cli/command-reference.md > resource (`r`) > Important options

<!-- replace -->

- `resource list --type <type>`
- `resource list --search <query>`

See [Interactive list keyboard reference](interactive-ux.md) for TTY browse/search shortcuts.
- `resource list --show-id`
- `resource show --format json`
- `resource show --show-id`
- `resource show --all-fields`
- `resource sync --overwrite`
- `resource sync --on-conflict <replace|skip|prompt|cancel>` - default `cancel`. Aliases for one release: `overwrite` -> `replace`, `ignore` -> `skip`, `fail` -> `cancel`.
- `resource sync --force`
- `resource sync --dry-run`
- `resource directories list --format json`
- `resource directories add <path>` - track a directory and import resources (skip existing)
- `resource directories remove <path>` - stop tracking a directory (library resources stay)
- `resource directories rescan` - re-scan home defaults and every tracked directory
- `resource list` shows material resources plus `plugin` resources; `plugin` composition refs are hidden by default
- `resource list --all` - show every resource per type (default caps at 10 per type)
- `plugin edit` selectors accept `type:name@namespace` for compose-safe resolution
- Host plugin pins are `plugin` resources; use `resource sync`, `plugin show`, `plugin doctor`, `plugin fork`, and `apply --strict-plugin-versions` for pin workflows

## docs/cli/command-reference.md > harness (`h`) > Important options

<!-- replace -->

- `harness list --supported` - only harnesses HarnessTap can serialize natively
- `harness list --format json`
- `harness set --harnesses <slugs>`
- `harness sync` - union registered harnesses (home) with last-write conflicts, including Claude/Cursor host plugin trees and `.agents` materialization for OpenCode-like harnesses; `--plugin-resources symlink|copy|clone`; `--project` for a repo; `--dry-run`
- `harness project set --project <path>`
- `harness project set --materialization-strategy <symlink-preferred|copy>`
- `harness project status --format json`

## docs/cli/command-reference.md > auth (`a`)

<!-- insert-after -->

### github

Authenticate with GitHub via the HarnessTap GitHub App device flow. Distinct from `auth` (HarnessTap Cloud). Stores a user-to-server token in `~/.harnesstap/github-session.json` (`0600`) and uses it for private GitHub marketplace and git reads (Authorization basic `x-access-token` extraheader, never a token in the clone URL). Private Contents require the App to be installed on the target account or org.

Does not require `gh`. Client id is public (`Iv23liiaeCAUoGKe2uUx`; override `HARNESSTAP_GITHUB_APP_CLIENT_ID`). Never commit a client secret. If token exchange or refresh needs one, set `HARNESSTAP_GITHUB_APP_CLIENT_SECRET`.

Credential precedence: `HARNESSTAP_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` → stored session → `gh auth token` → ambient Git.

#### Commands

- `github login`
- `github status`
- `github logout`

#### Important options

- `github status --format json`

## Catalog and Cloud

<!-- append -->

`plugin list` and `profile list` read the local library by default. Pass `--remote` to include catalog results (local plus catalog). `--remote-only` still lists catalog only. `plugin search` is unchanged.

## docs/cli/command-reference.md > plugin (`l`)

<!-- append -->

`plugin list` lists local plugins by default. Pass `--remote` to include streamed catalog plugins (local plus catalog). `--search` filters the listed sources.

## docs/cli/command-reference.md > profile (`p`)

<!-- append -->

`profile list` lists local profile plugins by default. Pass `--remote` to include catalog profiles with tag=profile.

## docs/cli/interactive-ux.md > `install`: plugin / profile list browser

<!-- append -->

`plugin list` and `profile list` interactive browse lists local plugins. `--remote` adds catalog sections.
