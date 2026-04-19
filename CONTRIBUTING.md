# Contributing to skilldeck

Thank you for your interest in contributing to `skilldeck`! This document provides instructions for setting up your local development environment and the workflow for making changes.

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

# Build the project
bun run build
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
