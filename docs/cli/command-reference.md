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
| `layer` | `l` |
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
- dynamic values such as local layer, profile layer, and resource names
- harness slugs, cloud accounts, and catalog layers (when authenticated) for supported commands

Install by appending or saving the script for your shell:

```bash
ht completion bash >> ~/.bashrc
ht completion zsh >> ~/.zshrc
ht completion fish > ~/.config/fish/completions/ht.fish
```

Restart your shell or source the file, then try `ht layer show <Tab>` to list local layers.

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
- `--no-default-profile` — skip seeding the `default` profile layer and `active-profile.json` pointer
- `--interactive` — prompt for harness selection instead of relying on explicit flags
- `--format <mode>` — `human` or `json`

`init` seeds a local `default` profile layer (tagged `profile`) and writes `active-profile.json` unless `--no-default-profile` is passed. Global apply does **not** run automatically — run `ht profile use default` to materialize home harness files.

## add

Install skills from a remote GitHub repo, Git URL, or local skill-package directory. Discovers skills recursively under `skills/` or `.agents/skills/`, imports the full package into the HarnessTap library, and installs a selected subset to disk.

```bash
ht add mattpocock/skills
ht add mattpocock/skills --list
ht add mattpocock/skills --skill caveman,grill-me --global --yes
ht add mattpocock/skills --create-layer mattpocock-skills --global -y
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
| `--layer <name>` | Attach installed skills to an existing layer |
| `--create-layer <name>` | Create a layer and attach installed skills |
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

Apply layers with `layer apply` (not under this group).

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
- `layer apply` can write files in non-git directories, but snapshots are only stored when the project has a git `origin`.
- `revert` requires a snapshot ID from `history`.
- `layer apply` resolves environment values through the cascade: home environment ◂ configured-layer default (last wins).

## layer (`l`)

Manage design plugins (resource bundles), composition attachments, portable bundle export/import, and HarnessTap Cloud catalog workflows.

Remote library discovery, install, and publish live on **`layer`**, not `auth`. Use `auth` only for authentication and org context.

### Commands

- `layer create <name>`
- `layer list` — local layers plus streamed remote catalog layers (default); use `--local-only` for local layers only
- `layer show <name>`
- `layer edit [name]` — interactively add/remove attachments, set default environment, or script changes with `--add` / `--remove` / `--apply` / `--environment` / `--clear-environment`
- `layer delete [name]`
- `layer apply [layer...]` — apply layer selectors, export paths, or URLs to a project (`l apply`); resolves the dependency graph and records `.harnesstap/lock.toml`
- `layer cut <layer> --version <semver>` — cut a new local version from the working head
- `layer pull <selector>` — download a remote layer bundle and import it
- `layer catalog list` — show default catalog, connected orgs/libraries, registered publish catalogs, and cloud base URL
- `layer catalog` — interactive publish-binding wizard (layer picker → catalog checkboxes)
- `layer catalog bindings [layer]` — show effective publish targets (non-TTY) or edit bindings (`--add`, `--remove`, `--clear`; `--add` replaces the full allow list)
- `layer catalog register org/catalog` — register a publish destination
- `layer catalog unregister org/catalog` — remove a publish destination from the registry
- `layer catalog registered` — list registered publish catalogs
- `layer catalog connect org <slug>` — opt into another org's public libraries
- `layer catalog disconnect org <slug>`
- `layer catalog connect layer <org>/<slug>` or `<org>/<catalog>/<slug>` — opt into a single public library
- `layer catalog disconnect layer <org>/<slug>` or `<org>/<catalog>/<slug>`
- `layer publish <layer>` — export bundle and upload to all effective publish targets (registered catalogs, or per-layer allow list)
- `layer publish plan <layer>` — dry-run: list effective targets and planned versions
- `layer diff <left> <right>`
- `layer doctor [name]` — validate a layer without writing to disk
- `layer why <target>` — explain why a version was selected or which layer won a resource (`skill:name`, layer name)
- `layer from-project [name] --project <path>`

### Important options

- `layer create -d, --description <text>` — layer description
- `layer create --tags <tags>` — comma-separated tags
- `layer create --version <semver>` — layer version (default `1.0.0`)
- `layer create --from <source>` — import a skill package (`owner/repo`, git URL, or local path) and attach selected skills
- `layer create --skill <names>` — comma-separated skills to attach when using `--from`
- `layer create --all` — attach all discovered skills when using `--from`
- `layer create --exclude-category <names>` — exclude skill categories (repeatable or comma-separated)
- `layer create --on-conflict <policy>` — when the layer exists: `cancel` (default), `merge`, or `overwrite`
- `layer create --install` — opt-in hub install; requires `--global` or `--project`
- `layer create --dry-run` — preview configuration without writing
- `layer list --format json`
- `layer list --show-id`
- `layer list -s, --search <query>` — filter local and remote layers by name, description, or tags
- `layer list --local-only` — list only local layers
- `layer list --remote-only` — skip local section; remote-only JSON emits a top-level array
- `layer list --tag <tag>` — filter remote catalog layers by tag
- `layer list --account <name>` / `--base-url <url>` — cloud account and base URL for remote listing
- `layer list --no-interactive` — disable TTY browse wizard (streaming print-only)

See [Interactive list keyboard reference](interactive-ux.md) for TTY browse/search shortcuts.

- `layer show --format json`
- `layer edit --type <type>` — restrict tables to one attachment type
- `layer edit --search <query>` — pre-fill the interactive search filter
- `layer edit --show-id`
- `layer edit --all` — show every resource per type (default caps at 10)
- `layer edit --dry-run` — preview membership changes without writing
- `layer edit --format json --no-interactive` — read-only membership snapshot
- `layer edit --add <selector>` — add attachment (repeatable; use `--type` when selector omits prefix)
- `layer edit --remove <selector>` — remove attachment (repeatable)
- `layer edit --apply <file.json>` — apply membership from JSON spec
- `layer edit --version <constraint>` — plugin or layer references only (scripting adds)
- `layer edit --sync` — sync a plugin resource immediately after add (default: lazy)
- `layer edit --embed` — mark plugin pin as embed-on-export when adding
- `layer edit --environment <name>` — bind a default environment to the configured layer that `layer apply` resolves
- `layer edit --clear-environment` — clear the configured layer default environment
- `layer apply --project <path>` — target project directory (default `.`)
- `layer apply --harness <slugs>` — comma-separated harness slugs
- `layer apply --dry-run` — show planned file writes only
- `layer apply --explain` — print the resolution trail (selected versions and every resource decision)
- `layer apply --update` — ignore `.harnesstap/lock.toml` and re-resolve the dependency graph
- `layer apply --strict-plugin-versions` / `--ignore-plugin-versions` / `--sync-plugins`
- `layer why --project <path>` — project with the lockfile to inspect (default `.`)
- `layer why --root <layer>` — resolve against this root instead of the lockfile root
- `layer why --format json`
- `layer cut --version <semver>` — required new version (must differ from the current head)
- `layer cut --format json`
- `layer diff --format json`
- `layer doctor --check <name>` — run one check (repeatable)
- `layer doctor --list-checks` — list available checks
- `layer doctor --format json` — exits `1` when the layer is invalid
- `layer from-project -d, --description <text>`
- `layer from-project --harness <slug>`
- `layer pull --as <name>`
- `layer pull --org <slug>`
- `layer pull --catalog <slug>` — catalog slug when selector omits catalog (default `default`)
- `layer pull --version <constraint>`
- `layer pull --account <name>`
- `layer pull --base-url <url>`
- `layer publish org/catalog` — one-off publish to a single catalog (does not change bindings)
- `layer publish --org <slug> --catalog <slug>` — one-off override (same as positional `org/catalog`)
- `layer publish --account <name>`
- `layer catalog bindings --add org/catalog` — replace per-layer allow list (repeatable; auto-registers missing catalogs)
- `layer catalog bindings --remove org/catalog` — remove one target from the allow list
- `layer catalog bindings --clear` — revert layer to all registered catalogs
- `layer catalog register --account <name>` — optional account for a registered catalog

`layer pull` and `layer list` remote discovery query catalog scope **plus** registered publish catalogs (`layer catalog register`). Use `layer catalog connect` to add other public orgs or libraries explicitly. Register publish destinations with `layer catalog register` before `layer publish` when no bindings exist. `layer pull` fails on local name conflict instead of overwriting. `layer apply` resolves bare catalog names at apply time; use `layer pull` to install layers for offline reuse. Apply resolves nested layer dependencies as a graph (nearest-to-root resource precedence; equal-depth set-like types use declaration order with a warning).

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

Manage profile layers (layers tagged `profile`) and global profile switching. Profiles apply to **machine home** harness paths; use `layer apply` for projects.

Root shorthand: when the first argument is not a known command and matches a local profile layer name, `ht <name>` runs `profile use <name>` (e.g. `ht work`).

### Commands

- `profile list` / `profile ls` — list local profile layers, then stream remote catalog layers with `tag=profile`; marks active profile
- `profile show <name>` — same detail view as `layer show`, plus active profile marker
- `profile status` — active profile and whether global harness files are in sync
- `profile use <name>` — merge profile stack, apply globally, set active pointer
- `profile create <name>` — create profile layer, promote an existing layer, or import from `--from`
- `profile delete <name>` — demote a profile layer and optionally delete the underlying layer
- `profile pull <selector>` — install from catalog (`layer pull` alias; warns if not profile-tagged)
- `profile publish <name>` — publish with profile validation warnings (`layer publish` alias)

### Important options

- `profile list --format json`
- `profile list -s, --search <query>` — filter local and remote profile layers
- `profile list --local-only` — list only local profile layers
- `profile list --remote-only` — skip local section
- `profile list --account <name>` / `--base-url <url>` / `--no-interactive`
- `profile show --format json`
- `profile show --show-id`
- `profile status --check` — exit 1 when global state is out of sync
- `profile status --harness <slugs>` / `--format json`
- `profile create -d, --description <text>`
- `profile create --from <source>` — same skill-package options as `layer create --from`
- `profile create --use` — apply globally and set active after create/promote
- `profile create --use --dry-run` — preview global apply
- `profile create -y, --yes` — skip the interactive enable prompt
- `profile delete --layer` — also delete the underlying layer without prompting
- `profile delete -y, --yes` — skip the interactive layer delete prompt
- `profile use --dry-run` — preview global file writes
- `profile use --harness <slugs>` — comma-separated harness slugs (default: global harness preference)
- `profile use --on-conflict <replace|skip|prompt>`
- `profile use --account <name>` — cloud account for auto-pull of missing published dependencies
- `profile use --base-url <url>`
- `profile use --no-pull` — fail when composition refs are missing locally
- `profile use --format json`
- `profile pull` — same flags as `layer pull` (`--as`, `--org`, `--catalog`, `--version`, `--account`, `--base-url`)
- `profile publish --org <slug>` / `--catalog <slug>` / `--account <name>` / `--format json`

`profile use` auto-pulls missing published `layer` composition refs by default. If the profile layer defines `default_environment_id`, the home active environment pointer is updated on switch.

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
- `resource list` shows material resources plus `plugin` resources; `layer` composition refs are hidden by default
- `resource list --all` — show every resource per type (default caps at 10 per type)
- `layer edit` selectors accept `type:name@namespace` for compose-safe resolution
- There is no top-level `plugin` command group; use `resource sync`, `layer show`, `layer doctor`, and `layer apply --strict-plugin-versions` for plugin workflows

## environment (`e`)

Manage named environment bundles (env vars, model config, permissions, and secret references) and global or per-terminal active-environment pointers.

Environment values are the runtime *how* configuration that plugins satisfy through `needs[]` contracts and MCP env keys. They are distinct from toolkit configuration (`harness_preferences`, `config.jsonc`).

### Commands

- `environment create <name>` — blank (default), from project (`--from-project`), or from configured layer requirements (`--from-layer`); interactive wizard on TTY when no mode flags are set
- `environment edit [name]` — interactively edit values, or use scripting flags for non-interactive updates
- `environment list`
- `environment show <name>` — values, secret refs, reverse references; `--layer` analyzes requirement gaps for a configured layer
- `environment delete [name]`
- `environment use <name>` — set the global active environment; `--local` applies only to this terminal session
- `environment status` — show active environment and terminal env var drift

### Important options

- `environment create --blank` — create an empty environment (default when no mode flag is set)
- `environment create --from-project <path>` — import scoped project values required by the layer stack
- `environment create --from-layer <selector>` — seed from configured layer `needs[]`, MCP env keys, and model metadata (repeatable or comma-separated)
- `environment create --refresh` — update an existing environment (`--from-project` only)
- `environment create --bind` — bind the new environment as the configured layer default (`--from-layer` only)
- `environment create --layers <selectors>` — configured layer scope for `--from-project` (default: project's last-applied layers)
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
- `environment show --layer <selector>` — compare environment values against a configured layer's requirements
- `environment show --format json` — includes `requirement_gaps` when `--layer` is set
- `environment delete --force` — delete even when referenced
- `environment delete --interactive` / `-y, --yes`
- `environment use --local` — session-scoped active environment without changing global pointer
- `environment status --layers <selectors>` — include configured layer default environments in expected values
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

Offline sharing for workspace archives, individual layers, or single resources — without publishing to the cloud catalog.

Use `migrate` when:

- setting up a new laptop from an existing HarnessTap install (full workspace)
- sharing a curated layer or resource with a teammate offline
- backing up your local workspace before a reinstall

For multiplayer distribution, use `layer publish` / `layer pull` via HarnessTap Cloud.

### Commands

- `migrate export [file]` — export workspace, layer, environment, or resource (interactive when `[file]` omitted on a TTY)
- `migrate import [file]` — import from archive or TOML (auto-detects scope from file format)
- `migrate resolve-order` — convert apply-order dependence into explicit resource overrides so previously applied results reproduce under graph resolution

### Important options

- `migrate export --workspace` — full workspace archive (`.tar.gz` or `.json`)
- `migrate export --layer <name>` — layer bundle TOML (`urn:harnesstap:layer:v1`); comma-separated for multi-layer
- `migrate export --resource <selector>` — single resource TOML (`urn:harnesstap:resource:v1`)
- `migrate export --environment <name>` — single environment TOML
- `migrate export -o, --file <path>` — output path (overrides positional)
- `migrate export --include-plugins` / `--embed-plugins` — embed plugin trees (workspace and layer scope)
- `migrate import --workspace` / `--layer` / `--resource` / `--environment` — force import scope
- `migrate export --format json` / `migrate import --format json` — machine-readable summary
- `migrate resolve-order --dry-run` — report planned override writes without changing layers
- `migrate resolve-order --format json`

Workspace archives include layer bundles, named environments (secret refs only), harness preferences, config, and `active-profile.json` when present. They do not include tracked project records, project snapshots, or cloud accounts.

See [Scenario 28](../scenarios/details/28-machine-migration.md) and [Scenario 17](../scenarios/details/17-migrate-state.md).
