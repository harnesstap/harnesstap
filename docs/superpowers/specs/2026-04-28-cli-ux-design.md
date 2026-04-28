# CLI UX Consistency and Automation Design

## Problem

`harnessdeck` is usable interactively today, but its command contract is uneven for AI and script-driven workflows:

- some commands show reusable entities with non-reusable identifiers
- similar commands accept different selector forms for the same entity type
- structured output is not exposed consistently
- interactive-capable behavior exists in services, but not every workflow has an explicit argv-only CLI path

The goal is to make the CLI predictable for both humans and automation without changing the default human-readable experience.

## Goals

- Keep human-readable output as the default.
- Add explicit machine-friendly output for structured commands.
- Make selector behavior consistent across similar commands.
- Ensure every workflow has a non-interactive CLI path.
- Preserve backwards compatibility unless a current behavior is actively harmful.

## Non-Goals

- Redesigning the entire command hierarchy.
- Making JSON the default output mode.
- Introducing hidden auto-detection that changes output shape based on TTY state.
- Replacing human-readable summaries with tables or interactive UIs by default.

## Design Summary

`harnessdeck` should follow a balanced command contract:

1. Human-readable output remains the default.
2. Structured commands support `--format json`.
3. Entity selectors are consistent within each entity type.
4. If human output shows an identifier for follow-up use, it shows the canonical reusable identifier.
5. Interactive flows are optional convenience layers only; the same behavior must always be expressible through flags and arguments.

## Command Contract

### Output Modes

Structured read/report commands expose:

- `--format human` (default)
- `--format json`

The initial JSON coverage should include:

- `resource list`
- `resource show`
- `preset list`
- `preset show`
- `project status`
- `project history`
- `platform list`
- `project apply --dry-run`
- `init`

Commands that primarily mutate state do not need full JSON payloads in the first pass unless they already return structured information that callers are likely to consume programmatically.

### Selector Rules

Selectors are standardized per entity type:

- **Presets**: commands targeting a preset accept preset name or full preset ID.
- **Resources**: commands targeting a resource accept resource name or full resource ID.
- **Snapshots**: commands use full snapshot IDs; history output prints the same full ID.

Ambiguous resource names are errors. Human output should show candidate rows; JSON output should return a structured ambiguity payload. The CLI must never silently choose the first match for an ambiguous selector.

### Reusable Identifiers in Human Output

When human output is intended to support follow-up commands, it must include canonical identifiers in reusable form:

- `resource list` prints full resource IDs
- `preset show` prints full resource IDs for attached resources
- `project history` prints full snapshot IDs

Human-readable output may still include names, descriptions, and compact summaries, but not in a way that hides the identifier needed for the next command.

## Workflow Improvements

### Resource and Preset Workflows

Resource workflows should round-trip cleanly:

1. `resource list`
2. `resource show ...`
3. `preset add ... ...`
4. `preset remove ... ...`

To support that, `preset add` and `preset remove` should accept the same resource selector forms as the rest of the resource-facing CLI, rather than requiring raw IDs only.

### Project History and Revert

`project history` should show full snapshot IDs so a user or agent can copy the value directly into `project revert`. The display and the accepted selector must match exactly.

### Harness Configuration

The repository already has an internal harness-selection service with both interactive and non-interactive behavior. The CLI should expose this explicitly rather than leaving it as an internal-only capability.

The first harness-management CLI should:

- expose a noun-based command group for harness preferences
- accept explicit flags for main harness, alias harnesses, and materialization strategy
- optionally support interactive selection as a convenience, not as a requirement
- behave fully non-interactively when all required flags are provided

The non-interactive path is the primary contract; interactive prompting is an optional wrapper.

## Output Shape

### Human Mode

Human mode stays concise and readable:

- short summaries
- explicit labels for single-object detail views
- canonical identifiers where follow-up commands are expected
- helpful ambiguity output with candidate rows

### JSON Mode

JSON mode should be stable and free of decorative prefixes. It should expose canonical IDs, names, descriptions, related items, and counts directly.

Examples of expected shapes:

- list commands return arrays of objects
- show/status commands return a single object
- ambiguity errors return an object containing error metadata plus candidate matches
- dry-run/apply summary commands return structured per-platform results

JSON mode should be deterministic enough for AI callers to consume without scraping.

## Error Handling

The CLI should use consistent failure behavior:

- **Not found**: clear error message, non-zero exit
- **Ambiguous selector**: clear error message, non-zero exit, candidate list in human mode and structured candidates in JSON mode
- **Invalid option/value**: explicit validation error, non-zero exit

No command should silently fall back from an ambiguous selector to a guessed match.

## Testing Strategy

Add regression coverage for:

- full reusable IDs in list/history output
- selector parity across `resource`, `preset`, and `project` workflows
- ambiguous resource names
- JSON output for each supported command
- harness-management non-interactive flows
- any interactive harness command still working when TTY prompting is used

Tests should verify both human mode and JSON mode where applicable.

## Documentation Changes

Update:

- README workflow examples to show reusable identifiers and `--format json`
- command help text so selector rules are explicit (`name or ID` where applicable)
- harness command help so the argv-only path is obvious

## Implementation Notes

The work should be done incrementally:

1. normalize selector resolution helpers per entity type
2. normalize human-readable identifier display for follow-up workflows
3. add shared output-format plumbing for structured commands
4. add harness CLI surfaces with explicit non-interactive flags
5. update tests and documentation together with each behavior change

This keeps compatibility risk low while converging the CLI on a clear contract.
