# skilldeck

`skilldeck` is a preset-based CLI for managing AI coding assistant configuration
across multiple tools. You can scan an existing repository, store the detected
instructions and skills in a local database, import supported defaults from
your home directory, group them into presets, and apply those presets back to
one or more target platforms.

## What you can do with it

`skilldeck` helps you keep assistant configuration in one place while still
materializing platform-specific files.

- Scan existing Claude Code, Codex, Cursor, and related project layouts.
- Store imported configuration as canonical resources in SQLite.
- Group resources into reusable presets.
- Apply a preset to one or more target platforms.
- Export or import presets as JSON bundles.
- Seed and apply built-in starter templates.
- Snapshot tracked projects before apply and revert them later.

## Requirements

You need Node 20 or later to run the built CLI.

## Install

You can install `skilldeck` globally with Bun either from the published npm
package or from a local checkout of this repository.

### Install from the npm registry

```bash
bun install -g skilldeck
skilldeck init
```

```bash
bunx skilldeck@latest init
```

### Install from a local git checkout

```bash
git clone https://github.com/bqbooster/skillset.git
cd skillset
bun install
bun run build
bun link
skilldeck init
```

`bun link` registers the current checkout as the global `skilldeck` command.
If your shell still cannot find it, make sure Bun's global bin directory is on
your `PATH`:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

## Quick start

The fastest way to try `skilldeck` is to initialize the local database, import
supported defaults from your home directory, scan an existing repository, and
then build a preset from the imported resources.

The visible CLI groups related actions under noun-based commands such as
`project`, `preset`, and `platform`. Older top-level verbs still work for now,
but they print deprecation warnings.

1. Initialize the local database and import any supported home-directory
   defaults.

   ```bash
   skilldeck init
   ```

2. Scan the current repository.

   ```bash
   skilldeck project scan .
   ```

3. List the imported resources.

   ```bash
   skilldeck resource list
   ```

4. Create a preset.

   ```bash
   skilldeck preset create my-setup --description "Shared project assistant setup"
   ```

5. Add imported resources to that preset.

   ```bash
   skilldeck preset add my-setup <resource-id>
   ```

6. Apply the preset to one or more target platforms.

   ```bash
   skilldeck project apply my-setup --project . --platform claude-code,codex,cursor
   ```

7. Check the tracked project state.

   ```bash
   skilldeck project status .
   skilldeck project history --project .
   ```

If the repository has a git `origin`, `skilldeck project apply` stores a
snapshot before it writes files. You can restore that snapshot later with
`skilldeck project revert`.

## Built-in presets

`skilldeck` ships with starter presets that are seeded during `skilldeck init`.
The same command also scans supported default folders in your home directory,
imports any resources it finds, and prints the discovered locations. Use these
commands to inspect and apply the built-in presets.

```bash
skilldeck preset list
skilldeck project apply nextjs-fullstack --project . --platform codex
```

The repository currently includes `nextjs-fullstack` and `python-fastapi`.

## Import and export

Presets can move between machines as JSON bundle files. Export strips local-only
database fields and keeps the portable preset definition plus its resources.

```bash
skilldeck preset export my-setup --file ./my-setup.skilldeck.json
skilldeck preset import ./my-setup.skilldeck.json
```

## Supported platforms

`skilldeck` has dedicated serializers for Claude Code, Codex, and Cursor. It
also registers a broader set of platforms through a generic path-driven
serializer, including GitHub Copilot, Windsurf, Warp, OpenCode, Roo, Continue,
Gemini CLI, and others.

Run this command to see the current registry in your installed version.

```bash
skilldeck platform list
```

## Where data lives

`skilldeck` stores its operational state in `~/.skilldeck/skilldeck.db`. The
database holds resources, presets, tracked projects, and snapshots. The current
implementation does not yet have a separate user-editable config file.

When you run `skilldeck init`, the CLI also checks registered platform default
folders in your home directory, such as `~/.claude/` and `~/.codex/`, and
imports any supported resources it finds.

## Contributing

If you'd like to contribute, please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for development and publishing instructions.
