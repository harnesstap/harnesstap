# HarnessDeck command reference

This page mirrors the grouped CLI surface exposed by `harnessdeck --help`. Use it as the canonical reference for command names, aliases, and the most important flags. For workflow examples, see the [README](../../README.md).

## Global options

Available on `harnessdeck` / `hd`:

- `-V, --harnessdeck-version` — print the HarnessDeck CLI version
- `-v, --verbose` — show verbose error output
- `--no-color` — disable ANSI colors
- `--no-interactive` — disable interactive prompts
- `-h, --help` — show help

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

## project (`p`)

Manage project scanning, apply state, snapshots, drift, and sync.

### Commands

- `project scan [path]` — import resources from a project tree (hash-aware upsert; prompts on content drift when interactive)
- `project apply <layer...>` — apply one or more layers, bundle paths, or bundle URLs
- `project drift [path]` — compare the working tree against the latest apply/sync snapshot
- `project sync [path]` — sync alias harness outputs from the main harness state
- `project history --project <path>` — list snapshots for a tracked project
- `project revert [snapshot-id]` — restore files from a previous snapshot
- `project status [path]` — show the current project status

### Important options

- `project scan -p, --platform <slug>` — scan only one harness
- `project scan --dry-run` — preview imports without writing to the DB
- `project scan --overwrite` — replace library rows when scan content differs
- `project scan --skip-existing` — keep existing rows when scan content differs
- `project scan --namespace <name>` — namespace for imported project resources
- `project scan --global` — install imported plugin sources into global harness locations
- `project scan --harness <slugs>` — harness targets for `--global` plugin installs
- `project apply --project <path>` — explicit target directory
- `project apply --platform <slugs>` — comma-separated harness slugs
- `project apply --dry-run` — show planned file writes only
- `project apply --format json`
- `project apply --strict-plugin-versions` — fail with exit code `2` on plugin pin mismatch
- `project apply --ignore-plugin-versions` — skip plugin pin validation entirely
- `project drift --format json` — exits `1` when drift exists
- `project sync --dry-run` — preview alias sync writes
- `project sync --force-shift-reference <slug>` — set the project main harness before syncing
- `project sync --format json`
- `project history --format json`
- `project status --format json`

`project apply --strict-plugin-versions` and `project apply --ignore-plugin-versions` are mutually exclusive.

### Preconditions and side effects

- `project history`, `project drift`, `harness project set`, and `harness project status` require a git-backed project.
- `project apply` can write files in non-git directories, but snapshots are only stored when the project has a git `origin`.
- `project revert` requires a snapshot ID from `project history`.

## layer (`l`)

Manage reusable bundles of resources and plugin pins.

### Commands

- `layer create <name>`
- `layer list`
- `layer show <name>`
- `layer attach [layer] [selector] --type <type>`
- `layer detach [layer] [selector] --type <type>`
- `layer delete [name]`
- `layer export <layer>`
- `layer import <file>`
- `layer search <query>`
- `layer add [selector]`
- `layer publish <layer>`
- `layer diff <left> <right>`
- `layer doctor [name]` — validate a layer without writing to disk (replaces the removed `layer validate`)
- `layer from-project [name] --project <path>`

### Important options

- `layer create -d, --description <text>` — layer description
- `layer create --tags <tags>` — comma-separated tags
- `layer create --version <semver>` — layer version (default `1.0.0`)
- `layer list --format json`
- `layer list --show-id`
- `layer show --format json`
- `layer attach --type <resource|skill|instruction|plugin|layer>` (`layer-dependency` is a deprecated alias for `layer`)
- `layer attach --version <constraint>` — plugin or layer references only
- `layer attach --sync` — sync a plugin resource immediately after attach (default: lazy)
- `layer attach --embed` — mark plugin resource as embed-on-export
- `layer export -f, --file <path>` — output bundle path
- `layer export --embed-plugins`
- `layer diff --format json`
- `layer doctor --check <name>` — run one check (repeatable)
- `layer doctor --list-checks` — list available checks
- `layer doctor --format json` — exits `1` when the layer is invalid
- `layer from-project -d, --description <text>`
- `layer from-project -p, --platform <slug>`
- `layer add --as <name>`
- `layer add --org <slug>`
- `layer add --version <constraint>`
- `layer search --profile <name>`
- `layer publish --profile <name>`

## resource (`r`)

Manage individual imported resources such as instructions, skills, rules, or agents.

### Commands

- `resource list`
- `resource show <selector>` — `name`, `type:name`, or `name@namespace`
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
- `resource list` shows material resources plus `plugin` resources; `layer` composition refs are hidden by default
- `resource list --all` — show every resource per type (default caps at 10 per type)
- `layer attach` selectors accept `type:name@namespace` for compose-safe resolution
- There is no top-level `plugin` command group; use `resource sync`, `layer show`, `layer doctor`, and `project apply --strict-plugin-versions` for plugin workflows

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

## cloud (`c`)

Manage HarnessDeck Cloud authentication and profile-local account state.

### Commands

- `cloud login [profile]`
- `cloud whoami`
- `cloud orgs`
- `cloud logout`

### Important options

- `cloud login --base-url <url>`
- `cloud whoami --profile <name> --format json`
- `cloud orgs --switch <slug>`
- `cloud logout --profile <name>`

## migrate

Move full HarnessDeck state between machines.

### Commands

- `migrate export <file>`
- `migrate import <file>`

### Important options

- `migrate export --include-plugins`
- `migrate export --format json`
- `migrate import --format json`
