# skillset

`skillset` is a preset-based CLI for managing AI coding assistant configuration
across multiple tools. You can scan an existing repository, store the detected
instructions and skills in a local database, import supported defaults from
your home directory, group them into presets, and apply those presets back to
one or more target platforms.

The project uses Bun for local development, CI, and builds. The published
package is still intended for the npm registry.

## What you can do with it

`skillset` helps you keep assistant configuration in one place while still
materializing platform-specific files.

- Scan existing Claude Code, Codex, Cursor, and related project layouts.
- Store imported configuration as canonical resources in SQLite.
- Group resources into reusable presets.
- Apply a preset to one or more target platforms.
- Export or import presets as JSON bundles.
- Seed and apply built-in starter templates.
- Snapshot tracked projects before apply and revert them later.

## Requirements

You need Node 20 or later to run the built CLI. You need Bun 1.3 or later if
you want to work on the repository itself.

## Install

If you are using the published package from the npm registry, install it with
`bun` or run it with `bunx`.

```bash
bun install -g skillset
skillset init
```

```bash
bunx skillset@latest init
```

If you are developing the project locally, use Bun.

```bash
bun install
bun run test:run
bun run lint
bun run build
```

## Quick start

The fastest way to try `skillset` is to initialize the local database, import
supported defaults from your home directory, scan an existing repository, and
then build a preset from the imported resources.

1. Initialize the local database and import any supported home-directory
   defaults.

   ```bash
   skillset init
   ```

2. Scan the current repository.

   ```bash
   skillset scan .
   ```

3. List the imported resources.

   ```bash
   skillset resource list
   ```

4. Create a preset.

   ```bash
   skillset preset create my-setup --description "Shared project assistant setup"
   ```

5. Add imported resources to that preset.

   ```bash
   skillset preset add my-setup <resource-id>
   ```

6. Apply the preset to one or more target platforms.

   ```bash
   skillset apply my-setup --project . --platform claude-code,codex,cursor
   ```

7. Check the tracked project state.

   ```bash
   skillset status .
   skillset history --project .
   ```

If the repository has a git `origin`, `skillset apply` stores a snapshot before
it writes files. You can restore that snapshot later with `skillset revert`.

## Built-in templates

`skillset` ships with starter templates that are seeded during `skillset init`.
The same command also scans supported default folders in your home directory,
imports any resources it finds, and prints the discovered locations. Use these
commands to inspect and apply the built-in templates.

```bash
skillset template list
skillset template apply nextjs-fullstack --project . --platform codex
```

The repository currently includes `nextjs-fullstack` and `python-fastapi`.

## Import and export

Presets can move between machines as JSON bundle files. Export strips local-only
database fields and keeps the portable preset definition plus its resources.

```bash
skillset export my-setup --file ./my-setup.skillset.json
skillset import ./my-setup.skillset.json
```

## Supported platforms

`skillset` has dedicated serializers for Claude Code, Codex, and Cursor. It
also registers a broader set of platforms through a generic path-driven
serializer, including GitHub Copilot, Windsurf, Warp, OpenCode, Roo, Continue,
Gemini CLI, and others.

Run this command to see the current registry in your installed version.

```bash
skillset platforms
```

## Where data lives

`skillset` stores its operational state in `~/.skillset/skillset.db`. The
database holds resources, presets, tracked projects, and snapshots. The current
implementation does not yet have a separate user-editable config file.

When you run `skillset init`, the CLI also checks registered platform default
folders in your home directory, such as `~/.claude/` and `~/.codex/`, and
imports any supported resources it finds.

## Develop and publish

If you are preparing a release, keep the development workflow on Bun and use
the npm registry only for distribution.

```bash
bun install
bun run test:run
bun run lint
bun run build
npm publish
```

The package runs `bun run build` in `prepublishOnly`, so the distribution build
is refreshed before publish.
