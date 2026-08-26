# Contributing to harnesstap

Thank you for your interest in contributing to `harnesstap`! This document provides instructions for setting up your local development environment and the workflow for making changes.

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
| `bun run link` | Build and register global `ht` / `harnesstap` |
| `bun run unlink` | Remove the global link |
| `bun run lint:fix` | Apply Biome lint fixes |
| `bun run clean` | Remove the `dist/` build output |
| `bun run docs:vhs` | Rebuild recorded CLI VHS scenarios |

### Running the CLI Locally

To run the CLI commands during development without having to build it first, you can execute the source file directly using `bun`. You have two options:

```bash
# Option 1: Using the start script defined in package.json
bun run start -- status .

# Option 2: Execute the TypeScript file directly
bun src/index.ts apply <plugin-name> --project .
```

### Installing the current checkout globally

If you want to exercise the built CLI exactly as an installed global command,
build and link the current checkout:

```bash
bun install
bun run link
ht status .
```

Re-run `bun run link` after changes when you want the global `ht` /
`harnesstap` commands to pick up a fresh build. Bun installs global executables
in `~/.bun/bin`, so make sure that directory is on your `PATH` if the command
is still not found. Use `bun run unlink` to remove the global link.

### Watch Mode

If you're making changes and want to continuously compile the TypeScript files for external CLI use or local package testing:

```bash
# Compile and watch for changes
bun run dev
```

## Workflow

### Changelog entries

We use [Changie](https://changie.dev/) for semver and `CHANGELOG.md`. Do not edit `CHANGELOG.md` by hand; your changes will be overwritten on release.

Install Changie on your machine (see the [installation guide](https://changie.dev/guide/installation/)), then for each user-facing pull request:

```bash
changie new
git add .changes/unreleased/
```

Commit the generated fragment with your PR.

**Package version vs preset version:** `package.json` semver is the npm CLI release only. Preset, plugin, and bundle versions inside HarnessTap are unrelated.

**Pre-1.0 semver:** While the package is `0.x.y`, breaking changes bump the minor version and compatible changes bump the patch version, per [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for initial development (`0.y.z`).

### Release (maintainers)

1. Merge pending PRs that include `.changes/unreleased/` fragments.
2. Run the **Generate Release PR** workflow (`changie-release-pr.yml`) from the Actions tab. The repo must allow GitHub Actions to create pull requests (Settings → Actions → General → Workflow permissions). The first cut batches `v0.1.0`; later cuts use `changie batch auto`.
3. Review and merge the release PR (updates `CHANGELOG.md` and `package.json`).
4. **Tag release** runs on `main` when `CHANGELOG.md` changes and pushes `vX.Y.Z` if that tag does not exist yet.
5. **Release** (`release.yml`) runs after that tag exists: lint/typecheck/sharded tests/build (same split as CI), `npm publish` via [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC, no `NPM_TOKEN`), a GitHub release whose body comes from `.changes/vX.Y.Z.md`, and unsigned Desktop installers attached to that release (macOS DMG, Windows NSIS/MSI, Linux AppImage/deb, x64 and arm). A human-pushed `v*` tag also triggers Release. Combined `bun run test:run` is not used in Release because TTY wizard mocks leak across the full suite. Re-run **Release** from Actions (`workflow_dispatch`) to attach desktop assets to an existing tag.

npm publish runs only in CI. The npm package's trusted publisher must point at workflow filename `release.yml` in `harnesstap/harnesstap`.

### Security

Report vulnerabilities privately — see [SECURITY.md](../SECURITY.md). Do not open public issues for security reports.

Local verification before a release:

```bash
bun run preflight
```

### Project Structure Notes

- The project uses Bun for local development, CI, and builds.
- The published package is intended for the npm registry.
- Contributor product spec: [`SPEC.md`](SPEC.md). User-facing docs: [`README.md`](README.md) and [`docs/`](docs/). Desktop UI language: [`apps/desktop/DESIGN.md`](apps/desktop/DESIGN.md).
