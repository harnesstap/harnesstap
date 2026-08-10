# HarnessTap command reference

This page mirrors the grouped CLI surface exposed by `harnesstap --help`. Use it as the canonical reference for command names, aliases, and the most important flags. For workflow examples, see the [README](../../README.md).

## Global options

Available on `harnesstap` / `ht`:

- `-V, --harnesstap-version` — print the HarnessTap CLI version
- `-v, --verbose` — show verbose error output
- `--no-color` — disable ANSI colors
- `--no-interactive` — disable interactive prompts
- `-h, --help` — show help

### Noun shorthand aliases

| Full noun | Alias |
| --- | --- |
| `plugin` | `l` (legacy shorthand from the old `layer` noun) |
| `resource` | `r` |
| `harness` | `h` |
| `environment` | `e` |
| `profile` | `p` |
| `auth` | `a` |
| `migrate` | `m` |

## help

Core HarnessTap concepts and a numbered scenario index. Scenario playbooks live in `docs/scenarios/details/`.

```bash
ht help
ht help --format json
ht help scenario 11
ht help scenario 7 --format json
```

## completion

Generate shell completion scripts for bash, zsh, or fish. After installation, Tab completes:

- subcommands and flags for every `ht` command
- dynamic values such as local plugin, profile plugin, and resource names
- harness slugs, cloud accounts, and catalog plugins (when authenticated) for supported commands

Install by appending or saving the script for your shell:

```bash
ht completion bash >> ~/.bashrc
ht completion zsh >> ~/.zshrc
ht completion fish > ~/.config/fish/completions/ht.fish
```

Restart your shell or source the file, then try `ht plugin show <Tab>` to list local plugins.

Both `ht` and `harnesstap` invocations are supported.

## init

Initialize local HarnessTap state.

```bash
ht init
ht init --main claude-code --aliases cursor,codex
ht init --format json
```

Key options:

- `--main <slug>` — set the default main harness
- `--aliases <slugs>` — comma-separated alias harnesses
- `--no-default-profile` — skip seeding the `default` profile plugin and `active-profile.json` pointer
- `--interactive` — prompt for harness selection instead of relying on explicit flags
- `--format <mode>` — `human` or `json`

`init` seeds a local `default` profile plugin (tagged `profile`) and writes `active-profile.json` unless `--no-default-profile` is passed. Global apply does **not** run automatically — run `ht profile use default` to materialize home harness files.

## add

Install skills from a remote GitHub repo, Git URL, or local skill-package directory. Discovers skills recursively under `skills/` or `.agents/skills/`, imports the full package into the HarnessTap library, and installs a selected subset to disk.

```bash
ht add mattpocock/skills
ht add mattpocock/skills --list
ht add mattpocock/skills --skill caveman,grill-me --global --yes
ht add mattpocock/skills --create-plugin mattpocock-skills --global -y
ht add ./local/skills-repo --project .
```

| Flag | Purpose |
| ---- | ------- |
| `--skill <names>` | Install subset (comma-separated) |
| `--all` | Install all discovered skills |
| `--harness <slugs>` | Target harnesses (default: main + alias harnesses from preferences) |
| `--global` | Install to user home paths |
| `--project [path]` | Install to project directory (default `.` when flag present without value) |
| `--method symlink\|copy` | Installation method (default `symlink`) |
| `--plugin <name>` | Attach installed skills to an existing plugin |
| `--create-plugin <name>` | Create a plugin and attach installed skills |
| `--list` | Discover skills only; no import or install |
| `--dry-run` | Show plan without writing |
| `-y, --yes` | Skip interactive prompts |
| `--format human\|json` | Output mode |

Scope rule: exactly one of `--global` or `--project` must be resolved before install (the wizard asks if neither is set). Import to the library always runs on a successful add except with `--list` or `--dry-run`.

## Project-local verbs

Git-style commands for working in a project directory. Each defaults to the current directory when `[path]` is omitted.

### Commands

- `scan [path]` — import resources from a project tree (hash-aware upsert; prompts on content drift when interactive)
- `mirror [path]` — mirror alias harness outputs from the main harness state
- `status [path]` — show project status with drift summary
- `history [path]` — list snapshots for a tracked project
- `revert [snapshot-id]` — restore files from a previous snapshot

Apply plugins with top-level `apply` (not under this group).

### Important options

- `scan --harness <slug>` — scan only one harness
- `scan --dry-run` — preview imports without writing to the DB
- `scan --overwrite` — replace library rows when scan content differs
- `scan --skip-existing` — keep existing rows when scan content differs
- `scan --namespace <name>` — namespace for imported project resources
- `scan --global` — install imported plugin sources into global harness locations
- `scan --harness <slugs>` — harness targets for `--global` plugin installs
- `mirror --dry-run` — preview alias mirror writes
- `mirror --force-shift-reference <slug>` — set the project main harness before mirroring
- `mirror --reference <strategy>` — reference source: main, plugin, agents, or auto
- `mirror --format json`
- `status --check` — exit `1` when drift exists since the last snapshot, or when `.harnesstap/lock.toml` disagrees with the applied manifest (CI)
- `status --format json` — includes a `drift` object when git-backed
- `history --format json`
- `history --show-id` — show full snapshot IDs in human tables

### Preconditions and side effects

- `history`, `status --check`, `harness project set`, and `harness project status` require a git repository with a configured `origin` remote.
- `apply` can write files in non-git directories, but snapshots are only stored when the project has a git `origin`.
- `revert` requires a snapshot ID from `history`.
- `apply` resolves environment values through the cascade: home environment ◂ configured-plugin default (last wins).

## apply

Top-level apply resolves a plugin (and its dependency graph) and materializes it.

- Default scope is the **project** (cwd / `--project`).
- Pass `--global` to materialize into machine home paths (profile plugins also update the active profile pointer when applicable).
- First human line reports destination (`→ project …` or `→ machine home …`).
- Flags include `--dry-run`, `--explain`, `--update`, `--harness`, `--strict-plugin-versions`, `--ignore-plugin-versions`, and `--sync-plugins`.

`ht layer …` is a hidden deprecated alias for `ht plugin …` for one release; prefer `ht plugin` and top-level `ht apply`.

## plugin (`l`)

Manage design plugins (resource bundles), composition attachments, portable bundle export/import, and HarnessTap Cloud catalog workflows.

Remote library discovery, install, and publish live on **`plugin`**, not `auth`. Use `auth` only for authentication and org context.

### Commands

- `plugin create <name>`
- `plugin list` — local plugins plus streamed remote catalog plugins (default); use `--local-only` for local plugins only
- `plugin show <name>`
- `plugin edit [name]` — interactively add/remove attachments, set default environment, or script changes with `--add` / `--remove` / `--apply` / `--environment` / `--clear-environment`
- `plugin delete [name]`
- Prefer top-level `apply [plugin...]` (see above). The old `plugin apply` / `l apply` spelling was removed when apply moved to the root.
- `plugin cut <plugin> --version <semver>` — cut a new local version from the working head
- `plugin fork <plugin>` — copy an upstream or catalog plugin into an editable authored plugin (default name `<plugin>-fork`)
- `plugin pull <selector>` — download a remote plugin bundle and import it
- `plugin catalog list` — show default catalog, connected orgs/libraries, registered publish catalogs, and cloud base URL
- `plugin catalog` — interactive publish-binding wizard (plugin picker → catalog checkboxes)
- `plugin catalog bindings [plugin]` — show effective publish targets (non-TTY) or edit bindings (`--add`, `--remove`, `--clear`; `--add` replaces the full allow list)
- `plugin catalog register org/catalog` — register a publish destination
- `plugin catalog unregister org/catalog` — remove a publish destination from the registry
- `plugin catalog registered` — list registered publish catalogs
- `plugin catalog connect org <slug>` — opt into another org's public libraries
- `plugin catalog disconnect org <slug>`
- `plugin catalog connect plugin <org>/<slug>` or `<org>/<catalog>/<slug>` — opt into a single public library
- `plugin catalog disconnect plugin <org>/<slug>` or `<org>/<catalog>/<slug>`
- `plugin publish <plugin>` — export bundle and upload to all effective publish targets (registered catalogs, or per-plugin allow list)
- `plugin publish plan <plugin>` — dry-run: list effective targets and planned versions
- `plugin diff <left> <right>`
- `plugin doctor [name]` — validate a plugin without writing to disk
- `plugin why <target>` — explain why a version was selected or which plugin won a resource (`skill:name`, plugin name)
- `plugin from-project [name] --project <path>`

### Important options

- `plugin create -d, --description <text>` — plugin description
- `plugin create --tags <tags>` — comma-separated tags
- `plugin create --version <semver>` — plugin version (default `1.0.0`)
- `plugin create --from <source>` — import a skill package (`owner/repo`, git URL, or local path) and attach selected skills
- `plugin create --skill <names>` — comma-separated skills to attach when using `--from`
- `plugin create --all` — attach all discovered skills when using `--from`
- `plugin create --exclude-category <names>` — exclude skill categories (repeatable or comma-separated)
- `plugin create --on-conflict <policy>` — when the plugin exists: `cancel` (default), `merge`, or `overwrite`
- `plugin create --install` — opt-in hub install; requires `--global` or `--project`
- `plugin create --dry-run` — preview configuration without writing
- `plugin list --format json`
- `plugin list --show-id`
- `plugin list -s, --search <query>` — filter local and remote plugins by name, description, or tags
- `plugin list --local-only` — list only local plugins
- `plugin list --remote-only` — skip local section; remote-only JSON emits a top-level array
- `plugin list --tag <tag>` — filter remote catalog plugins by tag
- `plugin list --account <name>` / `--base-url <url>` — cloud account and base URL for remote listing
- `plugin list --no-interactive` — disable TTY browse wizard (streaming print-only)

See [Interactive list keyboard reference](interactive-ux.md) for TTY browse/search shortcuts.

- `plugin show --format json`
- `plugin edit --type <type>` — restrict tables to one attachment type
- `plugin edit --search <query>` — pre-fill the interactive search filter
- `plugin edit --show-id`
- `plugin edit --all` — show every resource per type (default caps at 10)
- `plugin edit --dry-run` — preview membership changes without writing
- `plugin edit --format json --no-interactive` — read-only membership snapshot
- `plugin edit --add <selector>` — add attachment (repeatable; use `--type` when selector omits prefix). Plugin dependencies use `plugin:ref@source` (marketplace, local path, git URL, or `org/catalog/name`); legacy `plugin_pin:` / `plugin:` still resolve with a notice
- `plugin edit --remove <selector>` — remove attachment (repeatable)
- `plugin edit --apply <file.json>` — apply membership from JSON spec
- `plugin edit --version <constraint>` — plugin dependencies only (scripting adds)
- `plugin edit --sync` — sync an upstream plugin immediately after add (default: lazy)
- `plugin edit --embed` — mark plugin dependency as embed-on-export when adding
- `plugin edit --environment <name>` — bind a default environment to the configured plugin that `apply` resolves
- `plugin edit --clear-environment` — clear the configured plugin default environment
- `apply --project <path>` — target project directory (default `.`)
- `apply --harness <slugs>` — comma-separated harness slugs
- `apply --dry-run` — show planned file writes only
- `apply --explain` — print the resolution trail (selected versions and every resource decision)
- `apply --update` — ignore `.harnesstap/lock.toml` and re-resolve the dependency graph
- `apply --strict-plugin-versions` / `--ignore-plugin-versions` / `--sync-plugins`
- `plugin why --project <path>` — project with the lockfile to inspect (default `.`)
- `plugin why --root <plugin>` — resolve against this root instead of the lockfile root
- `plugin why --format json`
- `plugin cut --version <semver>` — required new version (must differ from the current head)
- `plugin cut --format json`
- `plugin fork --as <name>` — name for the authored fork (default `<plugin>-fork`)
- `plugin fork --format json`
- `plugin diff --format json`
- `plugin doctor --check <name>` — run one check (repeatable)
- `plugin doctor --list-checks` — list available checks
- `plugin doctor --format json` — exits `1` when the plugin is invalid
- `plugin from-project -d, --description <text>`
- `plugin from-project --harness <slug>`
- `plugin pull --as <name>`
- `plugin pull --org <slug>`
- `plugin pull --catalog <slug>` — catalog slug when selector omits catalog (default `default`)
- `plugin pull --version <constraint>`
- `plugin pull --account <name>`
- `plugin pull --base-url <url>`
- `plugin publish org/catalog` — one-off publish to a single catalog (does not change bindings)
- `plugin publish --org <slug> --catalog <slug>` — one-off override (same as positional `org/catalog`)
- `plugin publish --account <name>`
- `plugin catalog bindings --add org/catalog` — replace per-plugin allow list (repeatable; auto-registers missing catalogs)
- `plugin catalog bindings --remove org/catalog` — remove one target from the allow list
- `plugin catalog bindings --clear` — revert plugin to all registered catalogs
- `plugin catalog register --account <name>` — optional account for a registered catalog

`plugin pull` and `plugin list` remote discovery query catalog scope **plus** registered publish catalogs (`plugin catalog register`). Use `plugin catalog connect` to add other public orgs or libraries explicitly. Register publish destinations with `plugin catalog register` before `plugin publish` when no bindings exist. `plugin pull` fails on local name conflict instead of overwriting. `apply` resolves bare catalog names at apply time; use `plugin pull` to install plugins for offline reuse. Apply resolves nested plugin dependencies as a graph (nearest-to-root resource precedence; equal-depth set-like types use declaration order with a warning).

## auth (`a`)

Manage HarnessTap Cloud authentication and cloud account state.

### Commands

- `auth login [account]`
- `auth status`
- `auth orgs`
- `auth logout`

### Important options

- `auth login --base-url <url>`
- `auth status --account <name> --format json`
- `auth orgs --switch <slug>`
- `auth logout --account <name>`

Token refresh runs before remote calls. The CLI does not silently switch accounts or organizations during other commands.

Token refresh runs before remote calls. The CLI does not silently switch accounts or organizations during other commands. There is no `--profile` flag — use `--account`.

## profile (`p`)

Manage profile plugins (plugins tagged `profile`) and global profile switching. Profiles apply to **machine home** harness paths; use `apply` for projects.

Root shorthand: when the first argument is not a known command and matches a local profile plugin name, `ht <name>` runs `profile use <name>` (e.g. `ht work`).

### Commands

- `profile list` / `profile ls` — list local profile plugins, then stream remote catalog plugins with `tag=profile`; marks active profile
- `profile show <name>` — same detail view as `plugin show`, plus active profile marker
- `profile status` — active profile and whether global harness files are in sync
- `profile use <name>` — merge profile stack, apply globally, set active pointer
- `profile create <name>` — create profile plugin, promote an existing plugin, or import from `--from`
- `profile delete <name>` — demote a profile plugin and optionally delete the underlying plugin
- `profile pull <selector>` — install from catalog (`plugin pull` alias; warns if not profile-tagged)
- `profile publish <name>` — publish with profile validation warnings (`plugin publish` alias)

### Important options

- `profile list --format json`
- `profile list -s, --search <query>` — filter local and remote profile plugins
- `profile list --local-only` — list only local profile plugins
- `profile list --remote-only` — skip local section
- `profile list --account <name>` / `--base-url <url>` / `--no-interactive`
- `profile show --format json`
- `profile show --show-id`
- `profile status --check` — exit 1 when global state is out of sync
- `profile status --harness <slugs>` / `--format json`
- `profile create -d, --description <text>`
- `profile create --from <source>` — same skill-package options as `plugin create --from`
- `profile create --use` — apply globally and set active after create/promote
- `profile create --use --dry-run` — preview global apply
- `profile create -y, --yes` — skip the interactive enable prompt
- `profile delete --plugin` — also delete the underlying plugin without prompting
- `profile delete -y, --yes` — skip the interactive plugin delete prompt
- `profile use --dry-run` — preview global file writes
- `profile use --harness <slugs>` — comma-separated harness slugs (default: global harness preference)
- `profile use --on-conflict <replace|skip|prompt>`
- `profile use --account <name>` — cloud account for auto-pull of missing published dependencies
- `profile use --base-url <url>`
- `profile use --no-pull` — fail when composition refs are missing locally
- `profile use --format json`
- `profile pull` — same flags as `plugin pull` (`--as`, `--org`, `--catalog`, `--version`, `--account`, `--base-url`)
- `profile publish --org <slug>` / `--catalog <slug>` / `--account <name>` / `--format json`

`profile use` auto-pulls missing published `plugin` composition refs by default. If the profile plugin defines `default_environment_id`, the home active environment pointer is updated on switch.

## resource (`r`)

Manage individual imported resources such as instructions, skills, rules, or agents.

### Commands

- `resource list`
- `resource show <selector>` — `name`, `type:name`, `type:name@namespace`, or ULID
- `resource sync [selector]` — refresh `marketplace_link` definitions and sync plugin resources from install roots
- `resource delete [resource]`

### Important options

- `resource list --type <type>`
- `resource list --search <query>`

See [Interactive list keyboard reference](interactive-ux.md) for TTY browse/search shortcuts.
- `resource list --show-id`
- `resource show --format json`
- `resource show --show-id`
- `resource show --all-fields`
- `resource sync --overwrite`
- `resource sync --on-conflict <overwrite|ignore|fail>` — default `fail`
- `resource sync --force`
- `resource sync --dry-run`
- `resource sync --prune` — remove orphaned child resources after sync
- `resource list` shows material resources plus `plugin` resources; `plugin` composition refs are hidden by default
- `resource list --all` — show every resource per type (default caps at 10 per type)
- `plugin edit` selectors accept `type:name@namespace` for compose-safe resolution
- There is no top-level `plugin` command group; use `resource sync`, `plugin show`, `plugin doctor`, `plugin fork`, and `apply --strict-plugin-versions` for plugin workflows

## environment (`e`)

Manage named environment bundles (env vars, model config, permissions, and secret references) and global or per-terminal active-environment pointers.

Environment values are the runtime *how* configuration that plugins satisfy through `needs[]` contracts and MCP env keys. They are distinct from toolkit configuration (`harness_preferences`, `config.jsonc`).

### Commands

- `environment create <name>` — blank (default), from project (`--from-project`), or from configured plugin requirements (`--from-plugin`); interactive wizard on TTY when no mode flags are set
- `environment edit [name]` — interactively edit values, or use scripting flags for non-interactive updates
- `environment list`
- `environment show <name>` — values, secret refs, reverse references; `--plugin` analyzes requirement gaps for a configured plugin
- `environment delete [name]`
- `environment use <name>` — set the global active environment; `--local` applies only to this terminal session
- `environment status` — show active environment and terminal env var drift

### Important options

- `environment create --blank` — create an empty environment (default when no mode flag is set)
- `environment create --from-project <path>` — import scoped project values required by the plugin stack
- `environment create --from-plugin <selector>` — seed from configured plugin `needs[]`, MCP env keys, and model metadata (repeatable or comma-separated)
- `environment create --refresh` — update an existing environment (`--from-project` only)
- `environment create --bind` — bind the new environment as the configured plugin default (`--from-plugin` only)
- `environment create --plugins <selectors>` — configured plugin scope for `--from-project` (default: project's last-applied plugins)
- `environment create --strict` — exit non-zero when required keys are missing
- `environment create --include-permissions` — include scanned permission resources (`--from-project` only)
- `environment create --description <text>`
- `environment create --dry-run` — preview without persisting
- `environment create --interactive` / `-y, --yes`
- `environment create --format json`
- `environment edit --var KEY=VALUE` / `--unset-var KEY` — scripting mode env var updates
- `environment edit --model <name>` / `--model-provider <provider>` / `--unset-model`
- `environment edit --permission action:pattern` / `--unset-permission <selector>`
- `environment edit --secret KEY:provider:ref` / `--unset-secret KEY`
- `environment edit --format json` — read-only edit snapshot (non-TTY)
- `environment edit --interactive` / `-y, --yes`
- `environment list --format json`
- `environment show --plugin <selector>` — compare environment values against a configured plugin's requirements
- `environment show --format json` — includes `requirement_gaps` when `--plugin` is set
- `environment delete --force` — delete even when referenced
- `environment delete --interactive` / `-y, --yes`
- `environment use --local` — session-scoped active environment without changing global pointer
- `environment status --plugins <selectors>` — include configured plugin default environments in expected values
- `environment status --check` — exit non-zero when terminal env vars drift from expected values
- `environment status --format json`

## harness (`h`)

Manage global harness preferences and git-backed project overrides.

### Commands

- `harness list`
- `harness set`
- `harness status`
- `harness project set`
- `harness project status`

### Important options

- `harness list --supported` — only harnesses HarnessTap can serialize natively
- `harness list --format json`
- `harness set --main <slug> --aliases <slugs>`
- `harness project set --project <path>`
- `harness project set --materialization-strategy <symlink-preferred|copy>`
- `harness project status --format json`

## migrate (`m`)

Offline sharing for workspace archives, individual plugins, or single resources — without publishing to the cloud catalog.

Use `migrate` when:

- setting up a new laptop from an existing HarnessTap install (full workspace)
- sharing a curated plugin or resource with a teammate offline
- backing up your local workspace before a reinstall

For multiplayer distribution, use `plugin publish` / `plugin pull` via HarnessTap Cloud.

### Commands

- `migrate export [file]` — export workspace, plugin, environment, or resource (interactive when `[file]` omitted on a TTY)
- `migrate import [file]` — import from archive or TOML (auto-detects scope from file format)
- `migrate resolve-order` — convert apply-order dependence into explicit resource overrides so previously applied results reproduce under graph resolution

### Important options

- `migrate export --workspace` — full workspace archive (`.tar.gz` or `.json`)
- `migrate export --plugin <name>` — plugin bundle TOML (`urn:harnesstap:layer:v1`; schema id still says `layer`); comma-separated for multi-plugin
- `migrate export --resource <selector>` — single resource TOML (`urn:harnesstap:resource:v1`)
- `migrate export --environment <name>` — single environment TOML
- `migrate export -o, --file <path>` — output path (overrides positional)
- `migrate export --include-plugins` / `--embed-plugins` — embed plugin trees (workspace and plugin scope)
- `migrate import --workspace` / `--plugin` / `--resource` / `--environment` — force import scope
- `migrate export --format json` / `migrate import --format json` — machine-readable summary
- `migrate resolve-order --dry-run` — report planned override writes without changing plugins
- `migrate resolve-order --format json`

Workspace archives include plugin bundles, named environments (secret refs only), harness preferences, config, and `active-profile.json` when present. They do not include tracked project records, project snapshots, or cloud accounts.

See [Scenario 28](../scenarios/details/28-machine-migration.md) and [Scenario 17](../scenarios/details/17-migrate-state.md).
