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
| `project` | `p` |
| `harness` | `h` |
| `environment` | `e` |
| `auth` | `a` |

## guide

Print quick-start commands and documentation links.

```bash
hd guide
hd guide --scenario 11
```

## scenario

Show a numbered scenario playbook from `docs/scenarios/details/`.

```bash
hd scenario 11
hd scenario 7 --format json
```

## concepts

Explain core HarnessDeck concepts (resource, layer, deck, environment, harness) and when to use common commands.

```bash
hd concepts
hd concepts --format json
```

## completion

Generate shell completion scripts for bash, zsh, or fish. After installation, Tab completes:

- subcommands and flags for every `hd` command
- dynamic values such as local layer, deck, and resource names
- harness slugs, cloud profiles, and catalog layers (when authenticated) for supported commands

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
- `--interactive` — prompt for harness selection instead of relying on explicit flags
- `--format <mode>` — `human` or `json`

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

## project (`p`)

Manage project scanning, apply state, snapshots, drift, and mirror.

### Commands

- `project scan [path]` — import resources from a project tree (hash-aware upsert; prompts on content drift when interactive)
- `project apply <layer...>` — **deprecated** alias for `layer apply`
- `project drift [path]` — compare the working tree against the latest apply/mirror snapshot
- `project mirror [path]` — mirror alias harness outputs from the main harness state
- `project history --project <path>` — list snapshots for a tracked project
- `project revert [snapshot-id]` — restore files from a previous snapshot
- `project status [path]` — show the current project status

### Important options

- `project scan -h, --harness <slug>` — scan only one harness
- `project scan --dry-run` — preview imports without writing to the DB
- `project scan --overwrite` — replace library rows when scan content differs
- `project scan --skip-existing` — keep existing rows when scan content differs
- `project scan --namespace <name>` — namespace for imported project resources
- `project scan --global` — install imported plugin sources into global harness locations
- `project scan --harness <slugs>` — harness targets for `--global` plugin installs
- `project apply --project <path>` — explicit target directory (prefer `layer apply`)
- `project apply --harness <slugs>` — comma-separated harness slugs
- `project apply --dry-run` — show planned file writes only
- `project apply --format json`
- `project apply --strict-plugin-versions` — fail with exit code `2` on plugin pin mismatch
- `project apply --ignore-plugin-versions` — skip plugin pin validation entirely
- `project apply --sync-plugins` — refresh stale plugin resources before materialize
- `project drift --format json` — exits `1` when drift exists
- `project mirror --dry-run` — preview alias mirror writes
- `project mirror --force-shift-reference <slug>` — set the project main harness before mirroring
- `project mirror --format json`
- `project history --format json`
- `project status --format json`

`project apply --strict-plugin-versions` and `project apply --ignore-plugin-versions` are mutually exclusive.

### Preconditions and side effects

- `project history`, `project drift`, `harness project set`, and `harness project status` require a git repository with a configured `origin` remote.
- `project apply` can write files in non-git directories, but snapshots are only stored when the project has a git `origin`.
- `project revert` requires a snapshot ID from `project history`.
- `layer apply` and `deck apply` resolve environment values through the cascade: home environment ◂ configured-layer default ◂ deck active environment (last wins).

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
- `layer pull --base-url <url>`
- `layer search --profile <name>`
- `layer search --base-url <url>`
- `layer publish --catalog <slug>` — target catalog slug (default `default`)
- `layer publish --profile <name>`

`layer pull` and `layer search` work without `auth login` for the default `harnessdeck-cloud` public catalog. Use `layer catalog connect` to add other public orgs or libraries explicitly. `layer pull` fails on local name conflict instead of overwriting. `layer apply` resolves bare catalog names at apply time; use `layer pull` to install layers for offline reuse.

## deck

Curate and apply portable deck repositories (`.harnessdeck/deck.toml`).

### Commands

- `deck list` — list deck records in the local database
- `deck show <name>` — ordered layer stack, environments, active environment
- `deck apply <deck> [layer...]` — apply a deck's layers; optional override layers append after the stack
- `deck delete [name]` — remove deck record (layers and on-disk repos unchanged)
- `deck export <deck> --output <dir>` — write portable hybrid deck repo
- `deck import <path>` — import deck repo into the local database
- `deck doctor <path>` — validate generated marketplace files against `deck.toml`

### Important options

- `deck show --format json` / `--show-id`
- `deck apply` accepts the same flags as `layer apply` (`--project`, `--harness`, `--dry-run`, plugin strictness, `--sync-plugins`)
- `deck delete --force` — skip confirmation when `root_path` is set
- `deck export --with-layer-exports` — include portable layer exports under `.harnessdeck/layers/`

## auth (`a`)

Manage HarnessDeck Cloud authentication and profile-local account state.

### Commands

- `auth login [profile]`
- `auth status`
- `auth orgs`
- `auth logout`

### Important options

- `auth login --base-url <url>`
- `auth status --profile <name> --format json`
- `auth orgs --switch <slug>`
- `auth logout --profile <name>`

Token refresh runs before remote calls. The CLI does not silently switch profiles or organizations during other commands.

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
- `environment use <name>` — set home or deck active environment; `--reapply` opt-in re-runs last applied layers
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
- `environment use --project <path>` — deck-scoped active environment
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

## migrate

Move full HarnessDeck state between machines.

### Commands

- `migrate export <file>`
- `migrate import <file>`

### Important options

- `migrate export --include-plugins`
- `migrate export --format json`
- `migrate import --format json`

Archives include exported layer bundles, harness preferences, and config. They do not include tracked project records, snapshots, or cloud profiles.
