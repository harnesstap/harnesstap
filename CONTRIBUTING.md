# Contributing to harnessdeck

Thank you for your interest in contributing to `harnessdeck`! This document provides instructions for setting up your local development environment and the workflow for making changes.

## Development Requirements

- **Bun**: You need [Bun](https://bun.sh/) 1.3 or later to work on the repository (local development, CI, and builds).
- **Node.js**: The package is built for Node 20 or later.

## Local Development

If you are developing the project locally, use Bun for package management and script execution.

```bash
# Install dependencies
bun install

# Run tests
bun run test:run

# Lint the codebase
bun run lint

# Type-check the codebase
bun run typecheck

# Build the project
bun run build
```

Common development commands:

| Command | Purpose |
| --- | --- |
| `bun run preflight` | CI-equivalent lint + typecheck + tests + build |
| `bun run test:run` | Run the full test suite with dot output |
| `bun run typecheck` | Run TypeScript-only validation |
| `bun run start -- <args>` | Run the grouped CLI from source |
| `bun run start:dist -- <args>` | Run the built CLI from `dist/` |
| `bun run lint:fix` | Apply Biome lint fixes |
| `bun run clean` | Remove the `dist/` build output |
| `bun run docs:vhs` | Rebuild recorded CLI VHS scenarios |

### Running the CLI Locally

To run the CLI commands during development without having to build it first, you can execute the source file directly using `bun`. You have two options:

```bash
# Option 1: Using the start script defined in package.json
bun run start -- project status .

# Option 2: Execute the TypeScript file directly
bun src/index.ts project apply <layer-name> --project .
```

### Installing the current checkout globally

If you want to exercise the built CLI exactly as an installed global command,
build the repository and install the current checkout globally with Bun.

```bash
bun install
bun run build
bun link
harnessdeck project status .
```

Re-run `bun run build && bun link` after changes when you want the global
`harnessdeck` command to pick up a fresh build from your checkout. Bun installs
global executables in `~/.bun/bin`, so make sure that directory is on your
`PATH` if the command is still not found.

### Watch Mode

If you're making changes and want to continuously compile the TypeScript files for external CLI use or local package testing:

```bash
# Compile and watch for changes
bun run dev
```

## Workflow

### Develop and publish

If you are preparing a release, keep the development workflow on Bun and use the npm registry only for distribution.

```bash
bun install
bun run test:run
bun run lint
bun run build
npm publish
```

The package runs `bun run build` in `prepublishOnly`, so the distribution build is refreshed before publish.

### Project Structure Notes

- The project uses Bun for local development, CI, and builds.
- The published package is intended for the npm registry.
