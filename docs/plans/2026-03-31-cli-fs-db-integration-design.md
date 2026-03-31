# CLI, filesystem, and database integration test design

This design defines the next test layer for `skillset`. The repository already
has unit coverage, serializer coverage, and command-level smoke tests. The
missing layer is a true integration matrix that drives real CLI commands,
asserts generated project files, and verifies persisted SQLite state together.

## Goals

This work must prove that the main user workflows hold together end to end,
rather than only at individual command boundaries.

- Cover the primary CLI flows from the specification with real command
  execution.
- Verify written platform files for native and generic targets.
- Verify persisted database state for resources, presets, projects,
  project-presets, and snapshots.
- Keep failures easy to localize by using focused scenarios instead of a few
  oversized journey tests.

## Approaches considered

There are three practical ways to add the next layer of coverage.

### Option 1: A few long end-to-end journey tests

This option would build one or two large user stories, such as scan -> preset
-> apply -> export -> import -> revert. It is easy to map back to how a person
uses the CLI, but failures are noisy and the setup becomes repetitive.

### Option 2: More command-level smoke tests

This option would extend the current `test/cli/*.test.ts` pattern with more
single-command checks. It is quick to add, but it still leaves important gaps
around data continuity across commands and process state.

### Option 3: A focused integration matrix

This option adds a new layer of multi-command scenarios. Each scenario covers
one main use case, but it asserts the full stack: CLI output, filesystem
materialization, and SQLite persistence.

We will use **Option 3**. It provides the best confidence for the specification
without collapsing everything into fragile mega-tests.

## Test architecture

The integration suite will sit beside the current CLI smoke tests and reuse the
existing helpers where possible. We will add a small number of new test helpers
only when the current `createTestContext`, `runCli`, git fixture, and file
helpers no longer keep the test code readable.

Each test will use:

- an isolated temporary HOME and project directory
- a disposable git repository when project tracking matters
- real CLI execution through `runCli()`
- direct model or database inspection after commands complete
- explicit file-content assertions for each target platform

The suite will stay black-box at the command boundary, but white-box for the
postconditions. That means the tests will drive `skillset` like a user while
still reading the database and output files directly to verify the result.

## Scenario matrix

The first pass should cover the main workflows from the specification.

### Cross-platform sync from GitHub Copilot format

This is the highest-value scenario from your scratchpad. Seed a project in the
generic `.agents/skills` plus `AGENTS.md` layout, scan it, group the imported
resources into a preset, and apply that preset to:

- `claude-code`
- `cursor`
- `opencode`
- `codex`

The assertions must cover:

- detected and imported resources
- preset membership and resource order
- generated files for each target platform
- tracked project and project-preset state
- `platforms`, `resource list`, `preset show`, and `status` output remaining
  consistent with the imported and applied data

### Preset and resource lifecycle

This scenario will create a preset, add imported resources, remove one, list
resources, show the preset, and confirm the stored order and membership in the
database. This proves the CLI remains consistent after scan-based imports.

### Export and import round-trip

This scenario will export a populated preset to a bundle, import it into a
clean isolated HOME, and then verify:

- the imported preset exists
- the imported resources are recreated without source-only fields
- the imported preset can be applied successfully in the new environment

The current specification exports one preset bundle at a time, so the
integration suite must reflect that boundary exactly.

### Snapshot, history, and revert

This scenario will apply a preset into a tracked git project, mutate the output
files, inspect `history`, and then run `revert`. The assertions must prove that
the snapshot captures the generated platform files and restores them correctly.

### Template-driven initialization

This scenario will run `init`, verify that templates are seeded, apply one of
the bundled templates, and confirm that the generated files and database state
match the normal preset-application path.

### Re-run and idempotency

This scenario will repeat `scan` or `apply` against the same project and verify
the expected deduplication and snapshot behavior from the current spec. It does
not need to force perfect global idempotency, but it must lock down the
documented behavior for repeated real-world use.

## File and database assertions

Each scenario will assert both external and internal outcomes.

Filesystem assertions should include:

- presence of expected files
- key content fragments that prove the right serializer path ran
- absence of unsupported files for a target platform when omission is the
  contract

Database assertions should include:

- imported resource count and types
- preset existence and ordered membership
- tracked project identity by normalized git origin
- applied preset linkage and recorded platform list
- snapshot creation when `apply` runs in a tracked git repository

## Failure handling and test boundaries

The integration suite should stay focused on common use cases, not exhaustive
error combinatorics. A scenario may include one key guard assertion, but the
main purpose is to prove the happy-path orchestration from the specification.

To keep failures readable:

- each test should center on one workflow
- helper setup should stay small and explicit
- assertions should prefer stable state over full-output snapshots
- platform file checks should focus on the minimum content that proves the
  serializer contract

## Verification

The new tests must integrate with the existing repository commands. We will
verify the final work with:

- `npm run test:run`
- `npm run lint`
- `npm run build`

## Next steps

The next step is to turn this design into an implementation plan, then add the
integration helpers, scenarios, and final verification.
