# Skillset test coverage design

## Goal

Add the first meaningful automated test suite for `skillset` so the core data
model, platform orchestration, and primary CLI workflows are covered without
making the tests brittle or expensive to maintain.

Because the user was unavailable during the design step, this document proceeds
with the recommended default approach described below.

## Chosen approach

Use a hybrid strategy:

- deep unit coverage for stable logic in `src/models`, `src/services`, and
  small platform helpers
- targeted serializer and file-writing tests with temporary directories
- smoke-style CLI tests for the highest-value command flows

This balances confidence with implementation cost. Pure CLI-first testing would
be slow and fragile, while pure unit testing would miss important command
orchestration paths.

## Coverage scope

The first pass should cover:

- database schema initialization and model CRUD behavior
- preset-resource associations and project-preset associations
- snapshot creation and restore behavior
- git URL normalization and project name extraction
- scan deduplication and apply/export orchestration behavior
- platform registry invariants
- serializer outputs for Claude Code, Cursor, Codex, and generic agents
- CLI smoke flows for `init`, `scan`, `preset`, `apply`, `history`, `revert`,
  `export`, `import`, `platforms`, `status`, and `template`

The first pass should not aim for exhaustive edge-case coverage of every
platform serializer path if that would block broad core coverage.

## Test architecture

### Unit tests

Create focused Vitest suites for:

- `src/db/schema.ts`
- `src/models/resource.ts`
- `src/models/preset.ts`
- `src/models/project.ts`
- `src/models/snapshot.ts`
- `src/services/git.ts`
- `src/services/scanner.ts`
- `src/services/applier.ts`
- `src/services/exporter.ts`
- `src/platforms/registry.ts`

Use isolated temporary SQLite databases per test suite or per test, depending
on mutation scope. Prefer real in-memory or temporary-disk SQLite over mocking
SQL behavior.

### Serializer tests

Add platform-specific tests that verify:

- scan behavior against fixture directories
- serialize behavior for representative resource sets
- preservation of important metadata
- omission of unsupported features where that is the intended behavior

Use temporary directories and real files instead of heavily mocking the
filesystem.

### CLI smoke tests

Add a thin CLI layer that executes the built entrypoint or command module
against temporary fixture projects and asserts:

- exit behavior
- important stdout/stderr messages
- created database records
- written bundle files
- written project files

These tests should focus on one happy path and one key failure path per command,
not exhaustive combinatorics.

## Fixtures and isolation

- use temp directories for projects, bundles, and output files
- create disposable git repos only where `getGitOrigin()` behavior is required
- isolate the `~/.skillset` database location per test run through environment
  control or test-local path overrides
- keep fixture content minimal and explicit so failures stay readable

## Error handling and success criteria

The suite should verify both happy paths and the most important failure cases:

- missing preset or resource
- invalid resource type filters
- missing snapshot IDs
- unsupported bundle versions
- empty platform detection paths

Success means:

- `npm run test:run` finds and executes real tests
- core model and service behavior is covered with stable assertions
- primary CLI workflows have smoke coverage
- tests remain isolated and do not mutate the developer's real local state

## Implementation notes

- start with the purest seams first so the suite becomes useful quickly
- extract shared test helpers only after duplication is clear
- prefer stable assertions on persisted state and file contents over snapshot
  testing entire command output
