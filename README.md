# harnessdeck

`harnessdeck` is a preset-based CLI for managing AI coding assistant configuration across multiple tools. You can scan an existing repository, store the detected instructions and skills in a local database, import supported defaults from your home directory, group them into presets, and apply those presets back to one or more target platforms.

## What you can do with it

`harnessdeck` helps you keep assistant configuration in one place while still materializing platform-specific files.

- Scan existing Claude Code, Codex, Cursor, GitHub Copilot, Copilot CLI, and related project layouts.
- Store imported configuration as canonical resources in SQLite.
- Group resources into reusable presets.
- Apply a preset to one or more target platforms.
- Create presets from scanned projects, diff presets, and validate them before apply.
- Record preset dependencies and Claude plugin version pins in portable preset bundles.
- Export or import presets as JSON bundles.
- Seed and apply built-in starter templates.
- Snapshot tracked projects before apply, detect drift later, and revert when needed.
- Search, install, and publish shared presets through HarnessDeck Cloud.
- Export your local preset library, harness preferences, and config for machine migration.

## Requirements

You need Node 20 or later to run the built CLI.

## Install

You can install `harnessdeck` globally with Bun either from the published npm package or from a local checkout of this repository.

### Install from the npm registry

```bash
bun install -g harnessdeck
hd init
```

```bash
bunx harnessdeck@latest init
```

### Install from a local git checkout

```bash
git clone https://github.com/bqbooster/harnessdeck.git
cd harnessdeck
bun install
bun run build
bun link
hd init
```

`bun link` registers the current checkout as the global `harnessdeck` and `hd` commands. After installation, you can invoke the CLI with either name. If your shell still cannot find them, make sure Bun's global bin directory is on your `PATH`:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

## Demo

Initialise HarnessDeck, scan an existing repository, browse built-in presets, apply one, and confirm the final state — all in about a minute:
[existing-repo-adoption demo](../output/01-existing-repo-adoption.gif)

```
harnessdeck init #initialise HarnessDeck in the repository
harnessdeck project scan . #detect existing resources
harnessdeck resource list #review discovered resources
harnessdeck preset list  #browse available presets
harnessdeck project apply nextjs-fullstack --project . --platform codex #apply a preset
harnessdeck project status . #confirm the final state
```

## Quick start

The fastest way to try `harnessdeck` is to initialize the local database, import supported defaults from your home directory, scan an existing repository, and then build a preset from the imported resources.

Once installed, `hd` is a shorthand alias for the same CLI. Use whichever form you prefer in the examples below.

The visible CLI groups related actions under noun-based commands such as `project`, `preset`, and `platform`. Older top-level verbs still work for now, but they print deprecation warnings.

1. Initialize the local database, import any supported home-directory defaults, and optionally choose a default main harness plus aliases.
  ```bash
   hd init
   hd init --main claude-code --aliases cursor,codex
  ```
2. Scan the current repository.
  ```bash
   hd project scan .
  ```
3. List the imported resources.
  ```bash
   hd resource list
  ```
4. Create a preset.
  ```bash
   hd preset create my-setup --description "Shared project assistant setup"
  ```
5. Add imported resources to that preset.
  ```bash
   hd preset add my-setup openapi-mcp-baseline
  ```
6. Apply the preset to one or more target platforms.
  ```bash
   hd project apply my-setup --project . --platform claude-code,codex,cursor
  ```
   `hd project apply` also accepts multiple preset names, a local `.harnessdeck.json` bundle, or a bundle URL. When you pass multiple preset names, later presets override earlier ones for matching resources and plugin pins.
7. Check the tracked project state.
  ```bash
   hd project status .
   hd project history --project .
  ```
8. Inspect or change harness preferences after init.
  ```bash
   hd harness status --format json
   hd harness set --main claude-code --aliases cursor,codex
  ```

If the repository has a git `origin`, `hd project apply` stores a snapshot before it writes files. You can restore that snapshot later with `hd project revert`.

## Built-in presets

`harnessdeck` ships with starter presets that are seeded during `hd init`. The same command also scans supported default folders in your home directory, imports any resources it finds, and prints the discovered locations. Use these commands to inspect and apply the built-in presets.

```bash
hd preset list
hd project apply nextjs-fullstack --project . --platform codex
```

The repository currently includes `nextjs-fullstack` and `python-fastapi`.

## More preset workflows

Use these commands when you want to compare, validate, or derive presets beyond the basic create/add/apply loop.

```bash
hd preset add-dependency team-stack shared-baseline --version "^1.2.0"
hd preset validate team-stack
hd preset diff team-stack ./team-stack.harnessdeck.json
hd preset from-project inferred-stack --project .
```

Preset dependencies are stored with semver constraints and round-trip through bundle export/import. `preset validate` checks for problems such as duplicate resources or invalid plugin pins, `preset diff` compares preset metadata and contents, and `preset from-project` scans a repository and turns the imported resources into a new preset.

## Import and export

Presets can move between machines as JSON bundle files. Export strips local-only database fields and keeps the portable preset definition plus its resources.

Preset bundles may also include Claude Code marketplace configuration under a top-level `claude` key. When you apply such a preset to a project with `claude-code`, harnessdeck merges `extraKnownMarketplaces` and `enabledPlugins` into `.claude/settings.json`:

```json
{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "preset": {
    "name": "team-stack",
    "version": "1.0.0",
    "description": "...",
    "tags": []
  },
  "claude": {
    "marketplaces": {
      "team-plugins": {
        "source": { "source": "github", "repo": "org/claude-plugins" },
        "autoUpdate": true
      }
    },
    "plugins": [
      { "id": "formatter@team-plugins", "enabled": true, "version": "1.2.0" }
    ]
  },
  "resources": [],
  "plugins": [],
  "embedded_plugins": []
}
```

```bash
hd preset export my-setup --file ./my-setup.harnessdeck.json
hd preset import ./my-setup.harnessdeck.json
```

## Plugin inventory

For Claude Code, **committed** plugins are those declared in the project’s `.claude/settings.json` (what you commit). **Effective** plugins are the merged result of user, project, and local settings—the configuration Claude actually loads.

```bash
hd plugin list
hd plugin show formatter@my-marketplace
hd plugin installed
hd preset add-plugin my-setup formatter@my-marketplace --version "2.1.0"
hd preset remove-plugin my-setup formatter@my-marketplace
hd preset export my-setup --file ./team.harnessdeck.json --embed-plugins
hd project apply my-setup --project . --strict-plugin-versions
```

On `project apply`, harnessdeck compares preset plugin pins to installed versions: it **warns** on mismatch by default; pass `**--strict-plugin-versions`** to fail the command (exit code 2), or `**--ignore-plugin-versions`** to skip validation.

Use `**hd -V**`, `**harnessdeck -V**`, or `**--harnessdeck-version**` for the harnessdeck CLI version. The `**--version**` on `preset add-plugin` is the **plugin semver pin or range**, not the global version flag.

Preset export bundles use schema `**urn:harnessdeck:bundle:v1`** and always include `plugins` and `embedded_plugins` arrays (empty when unused). `dependencies` is included when a preset declares versioned dependencies. See [bundle format](docs/superpowers/specs/2026-05-19-claude-plugin-inventory-design.md#bundle-format) in the design spec.

## Plugin check and update

Implementation notes and rollout for check/update live in [docs/superpowers/plans/2026-05-19-plugin-check-update.md](docs/superpowers/plans/2026-05-19-plugin-check-update.md).

Check and update plugins for harnesses that expose a discoverable plugin layout (Claude Code and Cursor today; more harnesses over time). Use `plugin installed` for the provider scan; use `plugin list` / `plugin show` for Claude **inventory** (committed vs effective) as described above.

```bash
hd plugin installed
hd plugin check --format json
hd plugin update --all
hd plugin refresh
```

Configure how often remote metadata is refreshed in `~/.harnessdeck/config.json`:

```json
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

Use `--refresh` on `plugin check` to force a marketplace/git refresh. Without it, harnessdeck uses cached metadata unless it is older than `refreshMaxAgeHours`.

## Project maintenance and migration

HarnessDeck keeps snapshots of generated project files for tracked repositories, which lets you inspect drift, sync alias harnesses, and move your local setup to another machine.

```bash
hd project drift --project .
hd project sync . --force-shift-reference claude-code
hd migrate export ./harnessdeck-migrate.tar.gz
hd migrate import ./harnessdeck-migrate.tar.gz
```

`project drift` compares the current working tree against the latest apply/sync snapshot. Migration archives export local preset bundles plus global harness preferences and `~/.harnessdeck/config.json`; cloud profiles remain in `cloud-profiles.json`.

## Supported platforms

`harnessdeck` has dedicated serializers for Claude Code, Codex, and Cursor. It also registers a broader set of platforms through a generic path-driven serializer, including GitHub Copilot, Copilot CLI, Windsurf, Warp, OpenCode, Roo, Continue, Gemini CLI, and others.

Run this command to see the current registry in your installed version.

```bash
hd platform list
```

## Where data lives

`harnessdeck` stores its operational state in `~/.harnessdeck/harnessdeck.db`. The database holds resources, presets, tracked projects, snapshots, and harness preference state. Optional settings (such as plugin refresh cache age) live in `~/.harnessdeck/config.json`.

When you run `hd init`, the CLI also checks registered platform default folders in your home directory, such as `~/.claude/` and `~/.codex/`, and imports any supported resources it finds.

## HarnessDeck Cloud

HarnessDeck can interact with the Harness cloud for publishing, searching, and installing shared presets. Local cloud profiles are stored in `~/.harnessdeck/cloud-profiles.json` by default. You can override the base HarnessDeck directory by setting the `HARNESSDECK_HOME` environment variable; profiles will live under `<HARNESSDECK_HOME>/cloud-profiles.json` when set.

Common workflows

- Authenticate and create a profile
harnessdeck cloud login [profile]
Options: --base-url  Cloud base URL (defaults to [https://harnessdeck.kayrnt.fr](https://harnessdeck.kayrnt.fr))
This performs device-code authentication in the browser/terminal and saves a named profile. If no name is provided the profile is saved as `default` and becomes the default profile.
- Inspect authenticated user
harnessdeck cloud whoami [--profile ] [--format json|human]
- List or switch organizations
harnessdeck cloud orgs [--profile ] [--switch ]
- Log out and remove a profile
harnessdeck cloud logout [--profile ]
- Search the remote preset catalog
harnessdeck preset search  [--profile ] [--format json|human]
- Install a preset from the cloud
harnessdeck preset install org/library[@version] [--as ] [--profile ]
Downloads a preset bundle from the cloud and imports it into the local preset database. Use `--as` to avoid name conflicts with existing presets.
- Publish a local preset to the cloud
harnessdeck preset publish  [--profile ]
- Apply an installed preset to a project
harnessdeck project apply  --project  [--platform ]

Notes

- The documentation above reflects the commands implemented in this branch. Run `harnessdeck <command> --help` for full details on flags and output formats.
- Cloud profiles are JSON files stored under the HarnessDeck directory (default `~/.harnessdeck/cloud-profiles.json`). Setting `HARNESSDECK_HOME` changes the directory where these files are written.

## Contributing

If you'd like to contribute, please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for development and publishing instructions.