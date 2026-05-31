# HarnessDeck command reference

This page mirrors the grouped CLI surface exposed by `harnessdeck --help`. Use it as the canonical reference for command names, aliases, and the most important flags. For workflow examples, see the [README](../../README.md).

## Global options

Available on `harnessdeck` / `hd`:

- `-V, --harnessdeck-version` — print the HarnessDeck CLI version
- `-v, --verbose` — show verbose error output
- `--no-color` — disable ANSI colors
- `--no-interactive` — disable interactive prompts
- `--show-hidden` — reveal compatibility aliases and hidden commands in help output
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
- `--format <mode>` — `human` or `json`

## project

Manage project scanning, apply state, snapshots, drift, and sync.

### Commands

- `project scan [path]` — import resources from a project tree
- `project apply <preset...>` — apply one or more presets, bundle paths, or bundle URLs
- `project drift [path]` — compare the working tree against the latest apply/sync snapshot
- `project sync [path]` — sync alias harness outputs from the main harness state
- `project history --project <path>` — list snapshots for a tracked project
- `project revert [snapshot-id]` — restore files from a previous snapshot
- `project status [path]` — show the current project status

### Important options

- `project apply --project <path>` — explicit target directory
- `project apply --platform <slugs>` — comma-separated harness slugs
- `project apply --dry-run` — show planned file writes only
- `project apply --strict-plugin-versions` — fail with exit code `2` on plugin pin mismatch
- `project apply --ignore-plugin-versions` — skip plugin pin validation entirely
- `project history --format json`
- `project status --format json`

`project apply --strict-plugin-versions` and `project apply --ignore-plugin-versions` are mutually exclusive.

### Preconditions and side effects

- `project history`, `project drift`, `harness project set`, and `harness project status` require a git-backed project.
- `project apply` can write files in non-git directories, but snapshots are only stored when the project has a git `origin`.
- `project revert` requires a snapshot ID from `project history`.

## preset (`p`)

Manage reusable bundles of resources and plugin pins.

### Commands

- `preset create <name>`
- `preset list`
- `preset show <name>`
- `preset attach [preset] [selector] --type <type>`
- `preset detach [preset] [selector] --type <type>`
- `preset delete [name]`
- `preset export <preset>`
- `preset import <file>`
- `preset search <query>`
- `preset add [selector]`
- `preset publish <preset>`
- `preset diff <left> <right>`
- `preset doctor [name]`
- `preset from-project [name] --project <path>`

### Important options

- `preset list --show-id`
- `preset show --format json`
- `preset attach --type <resource|skill|instruction|plugin|preset-dependency>`
- `preset attach --version <constraint>`
- `preset export --embed-plugins`
- `preset add --as <name>`
- `preset add --org <slug>`
- `preset add --version <constraint>`
- `preset search --profile <name>`
- `preset publish --profile <name>`

## resource (`r`)

Manage individual imported resources such as instructions, skills, rules, or agents.

### Commands

- `resource list`
- `resource show <resource>`
- `resource delete [resource]`

### Important options

- `resource list --type <type>`
- `resource list --search <query>`
- `resource list --show-id`
- `resource show --format json`
- `resource show --show-id`

## harness (`h`)

Manage global harness preferences and git-backed project overrides.

### Commands

- `harness list`
- `harness set`
- `harness status`
- `harness project set`
- `harness project status`

### Important options

- `harness list --supported`
- `harness set --main <slug> --aliases <slugs>`
- `harness project set --project <path>`
- `harness project set --materialization-strategy <symlink-preferred|copy>`
- `harness project status --format json`

## plugin

Manage plugin inventory, provider discovery, refresh, update, and reporting.

### Commands

- `plugin list [path]`
- `plugin show <ref> [path]`
- `plugin installed [path]`
- `plugin check [path]`
- `plugin update [ref]`
- `plugin refresh`

### Important options

- `plugin installed --platform <slugs>`
- `plugin check --platform <slugs>`
- `plugin check --scope <scopes>`
- `plugin check --refresh`
- `plugin update --all`
- `plugin update --yes`
- `plugin refresh --format json`

### Exit code notes

- `plugin check` exits `1` when outdated plugins are found.
- `plugin update` exits `1` when any requested plugin update fails.

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

## Hidden compatibility aliases

These commands still work for compatibility, but they are hidden from normal help output and emit deprecation warnings:

| Hidden alias | Current grouped command |
| --- | --- |
| `scan` | `project scan` |
| `apply` | `project apply` |
| `history` | `project history` |
| `revert` | `project revert` |
| `status` | `project status` |
| `export` | `preset export` |
| `import` | `preset import` |
| `platforms` | `harness list` |

Run `hd --help --show-hidden` if you need to inspect the compatibility layer directly.
