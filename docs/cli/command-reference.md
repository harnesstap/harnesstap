# HarnessDeck command reference

This page mirrors the grouped CLI surface exposed by `harnessdeck --help`. Use it as the canonical reference for command names, aliases, and the most important flags. For workflow examples, see the [README](../../README.md).

## Global options

Available on `harnessdeck` / `hd`:

- `-V, --harnessdeck-version` — print the HarnessDeck CLI version
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

Core HarnessDeck concepts and a numbered scenario index. Scenario playbooks live in `docs/scenarios/details/`.

```bash
hd help
hd help --format json
hd help scenario 11
hd help scenario 7 --format json
```

## completion

Generate shell completion scripts for bash, zsh, or fish. After installation, Tab completes:

- subcommands and flags for every `hd` command
- dynamic values such as local layer, profile layer, and resource names
- harness slugs, cloud accounts, and catalog layers (when authenticated) for supported commands

Install by appending or saving the script for your shell:

```bash
hd completion bash >> ~/.bashrc
hd completion zsh >> ~/.zshrc
hd completion fish > ~/.config/fish/completions/hd.fish
```

Restart your shell or source the file, then try `hd layer show <Tab>` to list local layers.

Both `hd` and `harnessdeck` invocations are supported.

## init

Initialize local HarnessDeck state.

```bash
hd init
hd init --main claude-code --aliases cursor,codex
hd init --format json
```

Key options:

- `--main <slug>` — set the default main harness
- `--aliases <slugs>` — comma-separated alias harnesses
- `--no-default-profile` — skip seeding the `default` profile layer and `active-profile.json` pointer
- `--interactive` — prompt for harness selection instead of relying on explicit flags
- `--format <mode>` — `human` or `json`

`init` seeds a local `default` profile layer (tagged `profile`) and writes `active-profile.json` unless `--no-default-profile` is passed. Global apply does **not** run automatically — run `hd profile use default` to materialize home harness files.

## add

Install skills from a remote GitHub repo, Git URL, or local skill-package directory. Discovers skills recursively under `skills/` or `.agents/skills/`, imports the full package into the HarnessDeck library, and installs a selected subset to disk.

```bash
hd add mattpocock/skills
hd add mattpocock/skills --list
hd add mattpocock/skills --skill caveman,grill-me --global --yes
hd add mattpocock/skills --create-layer mattpocock-skills --global -y
hd add ./local/skills-repo --project .
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

- `scan -h, --harness <slug>` — scan only one harness
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
- `status --check` — exit `1` when drift exists since the last snapshot (CI)
- `status --format json` — includes a `drift` object when git-backed
- `history --format json`
- `history --show-id` — show full snapshot IDs in human tables

### Preconditions and side effects

- `history`, `status --check`, `harness project set`, and `harness project status` require a git repository with a configured `origin` remote.
- `layer apply` can write files in non-git directories, but snapshots are only stored when the project has a git `origin`.
- `revert` requires a snapshot ID from `history`.
- `layer apply` resolves environment values through the cascade: home environment ◂ configured-layer default (last wins).

## layer (`l`)

Manage design plugins (resource bundles), composition attachments, portable bundle export/import, and HarnessDeck Cloud catalog workflows.

Remote library discovery, install, and publish live on **`layer`**, not `auth`. Use `auth` only for authentication and org context.

### Commands

- `layer create <name>`
- `layer list`
- `layer show <name>`
- `layer combine [layer] [selector] --type <type>`
- `layer uncombine [layer] [selector] --type <type>`
- `layer delete [name]`
- `layer export <layer>`
- `layer import <file>` — import a local bundle file (`urn:harnessdeck:layer:v1`)
- `layer apply [layer...]` — apply layer selectors, export paths, or URLs to a project (`l apply`)
- `layer search <query>` — search libraries in the local catalog scope (default: `harnessdeck-cloud` public libraries)
- `layer pull [selector]` — download a remote layer bundle and import it
- `layer catalog list` — show default catalog, connected orgs/libraries, and cloud base URL
- `layer catalog connect org <slug>` — opt into another org's public libraries
- `layer catalog disconnect org <slug>`
- `layer catalog connect layer <org>/<slug>` or `<org>/<catalog>/<slug>` — opt into a single public library
- `layer catalog disconnect layer <org>/<slug>` or `<org>/<catalog>/<slug>`
- `layer publish <layer>` — export bundle and upload to HarnessDeck Cloud
- `layer diff <left> <right>`
- `layer doctor [name]` — validate a layer without writing to disk
- `layer from-project [name] --project <path>`
- `layer set-environment <layer> <environment>` — bind a default environment to the configured layer that `layer apply` resolves
- `layer unset-environment <layer>` — clear the configured layer default environment

### Important options

- `layer create -d, --description <text>` — layer description
- `layer create --tags <tags>` — comma-separated tags
- `layer create --version <semver>` — layer version (default `1.0.0`)
- `layer list --format json`
- `layer list --show-id`
- `layer show --format json`
- `layer combine --type <resource|skill|instruction|plugin|layer>`
- `layer combine --version <constraint>` — plugin or layer references only
- `layer combine --sync` — sync a plugin resource immediately after combine (default: lazy)
- `layer combine --embed` — mark plugin resource as embed-on-export
- `layer export -f, --file <path>` — output bundle path
- `layer export --embed-plugins`
- `layer apply --project <path>` — target project directory (default `.`)
- `layer apply --harness <slugs>` — comma-separated harness slugs
- `layer apply --dry-run` — show planned file writes only
- `layer apply --strict-plugin-versions` / `--ignore-plugin-versions` / `--sync-plugins`
- `layer diff --format json`
- `layer doctor --check <name>` — run one check (repeatable)
- `layer doctor --list-checks` — list available checks
- `layer doctor --format json` — exits `1` when the layer is invalid
- `layer from-project -d, --description <text>`
- `layer from-project -h, --harness <slug>`
- `layer pull --as <name>`
- `layer pull --org <slug>`
- `layer pull --catalog <slug>` — catalog slug when selector omits catalog (default `default`)
- `layer pull --version <constraint>`
- `layer pull --account <name>`
- `layer pull --base-url <url>`
- `layer search --account <name>`
- `layer search --base-url <url>`
- `layer publish --catalog <slug>` — target catalog slug (default `default`)
- `layer publish --account <name>`

`layer pull` and `layer search` work without `auth login` for the default `harnessdeck-cloud` public catalog. Use `layer catalog connect` to add other public orgs or libraries explicitly. `layer pull` fails on local name conflict instead of overwriting. `layer apply` resolves bare catalog names at apply time; use `layer pull` to install layers for offline reuse.

## auth (`a`)

Manage HarnessDeck Cloud authentication and cloud account state.

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

Root shorthand: when the first argument is not a known command and matches a local profile layer name, `hd <name>` runs `profile use <name>` (e.g. `hd work`).

### Commands

- `profile list` — list local layers tagged `profile`; marks active profile
- `profile show <name>` — profile metadata, layer dependencies, active marker
- `profile active` — print active profile from `~/.harnessdeck/active-profile.json`
- `profile use <name>` — merge profile stack, apply globally, set active pointer
- `profile create <name>` — create empty layer with `tags: [profile]`
- `profile tag <layer>` — add `profile` tag to an existing layer
- `profile untag <layer>` — remove `profile` tag (clears active pointer if needed)
- `profile search <query>` — catalog search with `tag=profile` filter
- `profile pull <selector>` — install from catalog (`layer pull` alias; warns if not profile-tagged)
- `profile publish <name>` — publish with profile validation warnings (`layer publish` alias)

### Important options

- `profile list --format json`
- `profile show --format json`
- `profile active --format json`
- `profile create -d, --description <text>`
- `profile use --dry-run` — preview global file writes
- `profile use --harness <slugs>` — comma-separated harness slugs (default: global harness preference)
- `profile use --on-conflict <replace|skip|prompt>`
- `profile use --account <name>` — cloud account for auto-pull of missing published dependencies
- `profile use --base-url <url>`
- `profile use --no-pull` — fail when composition refs are missing locally
- `profile use --format json`
- `profile search --account <name>` / `--base-url <url>` / `--format json`
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
- `layer combine` selectors accept `type:name@namespace` for compose-safe resolution
- There is no top-level `plugin` command group; use `resource sync`, `layer show`, `layer doctor`, and `layer apply --strict-plugin-versions` for plugin workflows

## environment (`e`)

Manage named environment bundles (env vars, model config, permissions, and secret references) and active-environment pointers.

Environment values are the runtime *how* configuration that plugins satisfy through `needs[]` contracts and MCP env keys. They are distinct from toolkit configuration (`harness_preferences`, `config.jsonc`).

### Commands

- `environment create <name>`
- `environment list`
- `environment show <name>`
- `environment delete <name>`
- `environment set <name>` — upsert values (`--var`, `--model`, `--permission`)
- `environment unset <name>`
- `environment secret set <name>` / `environment secret unset <name>`
- `environment import <file>` / `environment export <name>`
- `environment use <name>` — set home active environment; `--reapply` opt-in re-runs last applied layers
- `environment active` — show active environment and cascade preview
- `environment resolve` — dry-run merged environment values per cascade tier
- `environment capture <name>` — create an environment from scoped project capture
- `environment refresh <name>` — update an existing environment from scoped project capture

### Important options

- `environment list --format json`
- `environment show --format json`
- `environment active --format json`
- `environment resolve --format json`
- `environment capture --project <path>` — required
- `environment capture --layers <selectors>` — default: project's last-applied configured layers
- `environment capture --strict` — exit non-zero when required keys are missing
- `environment capture --include-permissions`
- `environment capture --dry-run --format json`
- `environment use --reapply`

## harness (`h`)

Manage global harness preferences and git-backed project overrides.

### Commands

- `harness list`
- `harness set`
- `harness status`
- `harness project set`
- `harness project status`

### Important options

- `harness list --supported` — only harnesses HarnessDeck can serialize natively
- `harness list --format json`
- `harness set --main <slug> --aliases <slugs>`
- `harness project set --project <path>`
- `harness project set --materialization-strategy <symlink-preferred|copy>`
- `harness project status --format json`

## migrate (`m`)

Move full HarnessDeck workspace state between machines — the offline sharing path when you want to hand off layers, environments, harness preferences, and config without publishing to the cloud catalog.

Use `migrate` when:

- setting up a new laptop from an existing HarnessDeck install
- sharing a curated layer library with a teammate offline (USB, internal file share, git LFS)
- backing up your local workspace before a reinstall

For surgical sharing of one layer, prefer `layer export` / `layer import`. For multiplayer distribution, use `layer publish` / `layer pull` via HarnessDeck Cloud.

### Commands

- `migrate export <file>` — write a portable archive of the local workspace
- `migrate import <file>` — restore layers, environments, harness preferences, and config from an archive

### Important options

- `migrate export --include-plugins` — embed plugin trees in exported layer bundles for offline portability
- `migrate export --format json` — machine-readable export summary
- `migrate import --format json` — machine-readable import summary

Archives include exported layer bundles, named environments (secret refs only — not secret values), harness preferences, config, and `active-profile.json` when present. They do not include tracked project records, project snapshots, or cloud accounts (`cloud-accounts.json` remains local per machine).

See [Scenario 28](../scenarios/details/28-machine-migration.md) for a one-command workflow and [Scenario 17](../scenarios/details/17-migrate-state.md) for a manual layer-by-layer alternative.
