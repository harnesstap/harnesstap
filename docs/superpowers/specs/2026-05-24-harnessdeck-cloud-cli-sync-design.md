# HarnessDeck Cloud CLI Integration Design

## Status

Approved on 2026-05-24.

Companion CLI-wire spec lives in the sibling `harnessdeck-cloud` repository:

- `docs/superpowers/specs/2026-05-24-harnessdeck-cli-sync-design.md`

This document is the harnessdeck-side integration spec. It defines how the existing `harnessdeck` CLI should expose those cloud capabilities locally.

## Problem

The cloud-side sync design defines auth flows, endpoints, tokens, publish/install behavior, and error codes, but it does not yet specify how those capabilities should fit into the current harnessdeck CLI.

Harnessdeck already has a noun-based command model (`preset`, `project`, `plugin`, `harness`), an existing bundle import/export pipeline, a local SQLite database, and user-scoped state under `HARNESSDECK_HOME` / `~/.harnessdeck`. The cloud integration should feel native to that structure rather than introducing a parallel CLI experience that bypasses existing concepts.

## Goals

- Keep the cloud spec as the source of truth for auth, endpoint contracts, and remote error vocabulary.
- Fit cloud features into the existing harnessdeck CLI shape with minimal conceptual duplication.
- Preserve the current separation between preset resolution/import and project application.
- Reuse existing preset bundle export/import behavior wherever possible.
- Keep human-readable output as the default while exposing structured JSON where automation benefits from it.
- Store cloud profiles and session state under the same user home root as the rest of harnessdeck.

## Non-Goals

- Re-specifying the full cloud API or token protocol in this repository.
- Making `project apply` directly responsible for remote fetch or auth in v1.
- Moving cloud credential state into the main SQLite schema in the first iteration.
- Redesigning the entire CLI around a new top-level cloud-only command family.
- Replacing `preset import` / `preset export` with a new bundle format.

## Design Summary

Harnessdeck should use a hybrid command model:

1. `harnessdeck cloud ...` owns authentication and remote context.
2. `harnessdeck preset ...` owns remote preset/library content operations.
3. `harnessdeck project apply ...` remains the on-disk materialization path.

This keeps auth discoverable, keeps preset operations where users already expect them, and avoids creating a second end-to-end workflow for applying configuration to a project.

## Relationship to Existing CLI Design

This spec extends the CLI contract defined in [`2026-04-28-cli-ux-design.md`](./2026-04-28-cli-ux-design.md):

- human-readable output remains the default
- structured commands expose `--format json`
- noun-based groups remain primary
- interactive behavior is optional convenience, not the only path
- follow-up workflows should use stable, copyable identifiers

Cloud integration should follow those same rules rather than creating special-case behavior.

## Command Boundaries

### `harnessdeck cloud`

This group owns session and remote context only:

- login
- logout
- whoami
- org listing / active-org switching
- profile selection and remote-default resolution

It should not become the primary place for preset content workflows.

### `harnessdeck preset`

This group owns library content workflows because cloud libraries are still preset bundles at the CLI boundary:

- search remote libraries
- install a remote library version into local harnessdeck state
- publish a local preset bundle to cloud

This keeps cloud content operations near the existing `preset import` and `preset export` behavior.

### `harnessdeck project`

This group remains responsible for applying already-resolved local inputs to a repo:

- `project apply` consumes preset names, local bundle files, or direct URLs as it does today
- it does not manage device login, token refresh, org selection, or remote library lookup in v1

The cloud-aware step ends before apply begins.

## Command Model

### Cloud commands

#### `harnessdeck cloud login`

Purpose: create or update a named cloud profile by running the device-code flow defined by the cloud spec.

Expected options:

- `--profile <name>` — profile name, default `default`
- `--cloud-url <url>` — override cloud base URL for login/bootstrap
- `--org <slug>` — optional initial active org if the token can access multiple orgs

Behavior:

1. Start device-code auth against the configured cloud base URL.
2. Open the verification URL when possible and always print the code + URL.
3. Persist the resulting profile under the harnessdeck home directory.
4. Record the active org, granted scopes, token expiry metadata, and refresh token.

#### `harnessdeck cloud logout`

Purpose: revoke or forget the current profile session.

Expected options:

- `--profile <name>`

Behavior:

- attempts remote token revocation when a refresh token is present
- removes local token material for that profile even if remote revoke fails
- does not delete unrelated profiles

#### `harnessdeck cloud whoami`

Purpose: show the resolved remote identity and active context.

Expected options:

- `--profile <name>`
- `--format <mode>`

Output should include:

- user summary
- cloud base URL
- active org
- active scopes
- access-token expiry

#### `harnessdeck cloud orgs`

Purpose: list accessible orgs and optionally switch the active org for a profile.

Expected options:

- `--profile <name>`
- `--switch <slug>`
- `--format <mode>`

Behavior:

- with no `--switch`, lists accessible orgs from the current profile
- with `--switch`, updates the active org in the local profile after validating access

### Preset commands

#### `harnessdeck preset search <query>`

Purpose: discover remote libraries without changing local state.

Expected options:

- `--profile <name>`
- `--tag <tag>`
- `--public`
- `--format <mode>`

Behavior:

- uses the active org by default
- uses the public search path when `--public` is provided
- returns stable structured output in JSON mode

`preset list` remains the local inventory command; `preset search` is the remote discovery verb.

#### `harnessdeck preset install <org>/<library>[@<version>]`

Purpose: download a remote library bundle and register it as a local preset.

Expected options:

- `--profile <name>`
- `--as <preset-name>` — optional local preset name override
- `--format <mode>`

Behavior:

1. Resolve profile and org context.
2. Download the requested bundle (default latest version).
3. Feed the bundle through the existing local import pipeline.
4. Register the resulting preset in local harnessdeck state.

Default naming should use the remote library slug unless `--as` is provided. If that local preset name already exists, the command should fail with a clear conflict error rather than silently overwriting.

`preset install` is intentionally distinct from `preset import`:

- `preset import` = local file/bundle ingestion
- `preset install` = remote registry fetch + local registration

#### `harnessdeck preset publish <preset>`

Purpose: publish a local preset bundle to a cloud library version.

Expected options:

- `--library <slug>` (required)
- `--profile <name>`
- `--version <semver>`
- `--changelog <text>`
- `--format <mode>`

Behavior:

1. Resolve the local preset by existing selector rules.
2. Export it through the existing bundle serializer.
3. Send the bundle through the cloud publish endpoint.
4. Print or return the published version summary.

This command should reuse the current bundle format and export semantics rather than introducing a cloud-only serialization path.

## Local State Design

### Home directory

Cloud state lives under the same harnessdeck home root already used by the DB and config:

- default: `~/.harnessdeck`
- override: `HARNESSDECK_HOME`

This keeps backup, inspection, and environment override behavior consistent with the rest of the CLI.

### Storage strategy

V1 should store cloud profile/session material in a file-based store under the harnessdeck home directory rather than in the main SQLite schema.

Rationale:

- avoids DB migrations for the first cloud feature set
- matches the profile-oriented auth model
- keeps credentials and active-org context easy to inspect and back up
- still integrates cleanly because harnessdeck already stores user-scoped state in this directory

### Suggested state shape

The exact filename is an implementation detail, but the stored model should cover:

- profile name
- cloud base URL
- active org slug and org ID
- granted scopes
- access token
- access token expiry
- refresh token
- refresh token expiry if available
- last resolved user summary

Profiles should be keyed by name, with one default active profile unless explicitly overridden by command flags.

## Shared Client Architecture

The implementation implied by this spec should introduce two shared layers:

### Cloud profile store

Responsibilities:

- read/write profile state under the harnessdeck home directory
- resolve default profile
- update active org
- clear token material on logout

### Cloud client

Responsibilities:

- device-code login
- token refresh
- authenticated request execution
- endpoint helpers for whoami, orgs, search, install, and publish
- consistent mapping of cloud error codes into CLI-facing errors

Preset commands should depend on these shared layers rather than embedding auth or token logic in command handlers.

## Data Flow

### Login

1. `cloud login` resolves `HARNESSDECK_HOME` / `~/.harnessdeck`.
2. It performs the device-code flow from the cloud spec.
3. It writes or updates the selected local profile.

### Search

1. `preset search` resolves the requested or default profile.
2. It refreshes the access token if necessary.
3. It queries the cloud endpoint.
4. It renders human output or stable JSON.

### Install

1. `preset install` resolves profile and org.
2. It refreshes auth if needed.
3. It downloads the bundle for the requested library version.
4. It imports that bundle through the existing local preset import path.
5. It returns the installed local preset summary.

### Publish

1. `preset publish` resolves a local preset.
2. It exports the preset with the existing bundle serializer.
3. It refreshes auth if needed.
4. It uploads the bundle to the publish endpoint.
5. It returns the published remote version summary.

## Output Contract

Human-readable output remains the default.

Structured output is required for:

- `cloud whoami`
- `cloud orgs`
- `preset search`
- `preset publish`
- `preset install`

JSON output should be stable and direct, consistent with the broader CLI UX design. Commands must not require callers to scrape decorative text to retrieve identifiers, versions, org slugs, or publish/install results.

## Error Handling

The cloud spec remains the source of truth for remote error codes. This spec defines local CLI behavior:

- expired access token → attempt refresh before failing
- refresh failure → stop with explicit re-login guidance
- missing profile → explicit error, non-zero exit
- missing active org when required → explicit error, non-zero exit
- ambiguous or conflicting local preset name on install → explicit error, non-zero exit
- wrong-org / forbidden / not-found / version-conflict remote failures → clear CLI message, non-zero exit

The CLI must not:

- silently start a new login flow during another command
- silently switch profiles or orgs
- silently overwrite an existing local preset during install

## Testing Strategy

Add coverage for:

- `cloud login/logout/whoami/orgs` profile persistence and org switching
- token refresh success and failure paths
- `preset search/install/publish` against mocked cloud responses
- install conflict handling when the local preset name already exists
- stable JSON output for every structured cloud-aware command
- end-to-end regression that a cloud-installed preset can be applied through the unchanged `project apply` flow

Use the existing CLI test harness and keep cloud-aware tests focused on command contracts and integration boundaries rather than restating server-side behavior already covered in the cloud repository.

## Documentation Impact

Update CLI help and user-facing docs so the distinction is obvious:

- `cloud ...` = auth and remote context
- `preset search` = remote discovery
- `preset install` = remote-to-local registration
- `preset import` = local bundle ingestion
- `project apply` = on-disk application step

## Implementation Notes

The expected implementation surfaces in harnessdeck are:

- CLI wiring in `src/index.ts`
- shared profile storage under the harnessdeck home directory
- a shared cloud client/auth module
- tests using `test/helpers/cli.ts`

This work should preserve the current noun-based UX and treat cloud features as an extension of existing preset/project workflows, not a second CLI living beside them.
