# VHS Scenario Coverage Design

**Status:** Drafted on 2026-05-22 under unattended autopilot. Default scope assumption: **Common + key Occasional** scenarios for the first PR.

## Problem

HarnessDeck already has a strong written scenario catalog in `docs/scenarios/`, but the repository does not yet have **executable terminal demos** that show the current CLI in action. That leaves three gaps:

1. Readers cannot quickly see the CLI flow for the most important workflows.
2. Scenario docs are not backed by a reproducible demo artifact stored in git.
3. There is no standard way to regenerate demo outputs when the CLI changes.

The goal is to add a small, maintainable VHS demo pack that makes the CLI easier to understand without trying to animate the full 28-scenario catalog in one pass.

## Goals

- Store the selected VHS **`.tape` sources in git**.
- Generate and commit a curated set of **GIF outputs** that GitHub renders inline.
- Cover the repo's **highest-value user journeys** rather than every documented scenario.
- Make regeneration deterministic through a **checked-in script** instead of ad hoc local commands.
- Link the demos from the scenario docs so they stay discoverable.

## Non-Goals

- Animating all 28 scenarios in the first PR.
- Adding VHS generation to the normal `bun run preflight` path.
- Depending on the contributor's real home directory or repo state.
- Replacing the written scenario docs; demos supplement them.

## Approaches

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **A. Single hero walkthrough** | One long tape that chains multiple workflows together | Lowest asset count; easy to embed in README | Hard to maintain, hard to link to specific scenarios, noisy diffs |
| **B. Curated scenario pack** | One tape and one GIF per selected workflow | Best balance of clarity, maintenance, and doc linking | More files than a single hero demo |
| **C. Full catalog generation** | Tape/GIF for every documented scenario | Maximum coverage and parity with docs | Too large for a first PR; higher maintenance and repo weight |

## Decision

Use **Approach B: curated scenario pack**.

The first PR should cover the workflows that best explain how a user adopts, applies, and maintains HarnessDeck state:

| Scenario | Why it belongs in v1 |
|----------|-----------------------|
| **1 — Bootstrap machine** | Establishes the first-run story and shows seeded presets/platform discovery |
| **4 — Scan existing repo** | Core "adopt an existing repo" workflow |
| **7 — Preview and apply preset** | Main materialization workflow; most important operational path |
| **11 — Start from a built-in preset** | Fastest new-user success path |
| **21 — Detect drift** | Key maintenance/debugging story with visible CLI feedback |
| **27 — Project sync** | Distinct cross-harness workflow that is easy to misunderstand from text alone |

Follow-up candidates after v1: **10** (export/import), **12** (script/JSON output), **23** (validate), **26** (from-project).

## Artifact Layout

Use a dedicated docs area so the tapes and rendered assets are easy to find:

| Path | Purpose |
|------|---------|
| `docs/scenarios/vhs/tapes/` | Checked-in `.tape` sources |
| `docs/scenarios/vhs/output/` | Generated `.gif` artifacts committed to the repo |
| `docs/scenarios/vhs/fixtures/` | Small deterministic fixture inputs used only for demos |
| `scripts/generate-vhs-scenarios.sh` | Regenerates one or all tapes |
| `docs/scenarios/vhs/README.md` | Explains prerequisites and generation flow |

The scenario index (`docs/scenarios/scenarios.md`) should link to the demo pack, and each covered scenario detail page should link to its corresponding GIF/tape pair.

## Demo Architecture

### Deterministic execution

Each tape should run against a **prepared temporary workspace**, not the contributor's real machine:

- A generation script creates a fresh temp root for each scenario.
- The script stages demo fixtures into predictable directories.
- The script sets `HOME` to the temp root so `harnessdeck init` writes into an isolated `~/.harnessdeck`.
- The generation script runs `bun run build` first, then tapes execute the built local CLI via `node dist/index.js`.

This keeps the GIFs reproducible and avoids leaking personal machine state into the demos.

### Shared tape conventions

All tapes should share a common look and pacing:

- `Output ...gif`
- `Require node`
- `Require vhs` handled by the generation environment rather than inside each tape
- consistent terminal size, font size, padding, theme, and typing speed
- short waits and explicit prompt cleanup so the GIF focuses on the CLI output

If VHS `Source` keeps the tapes simpler, use a shared header tape for common settings.

### Fixture strategy

Prefer **small dedicated VHS fixtures** over reusing large test fixtures wholesale.

Why:

- Demo fixtures should be visually legible in a terminal recording.
- Tests optimize for breadth; demos optimize for clarity.
- Keeping VHS fixtures narrowly scoped reduces output noise and regeneration time.

It is still fine to borrow small files or patterns from `test/fixtures/` when that avoids duplication.

## Documentation Changes

1. Add a short **VHS demos** landing page under `docs/scenarios/vhs/README.md`.
2. Add a demo link or indicator from `docs/scenarios/scenarios.md`.
3. Add per-scenario links on the six covered detail pages:
   - `View demo GIF`
   - `View tape source`

Keep the README changes light unless one GIF clearly improves the top-level project story.

## Error Handling

The generation script should fail loudly when prerequisites are missing:

- missing `vhs`
- missing `ffmpeg` / `ttyd` dependencies indirectly required by VHS
- missing `bun` for the pre-render build step

It should also stop on scenario generation failure instead of silently skipping tapes.

## Verification

Implementation should verify:

1. The generation script can render the selected tapes end-to-end on a clean checkout.
2. The generated GIFs are written to the checked-in `docs/scenarios/vhs/output/` paths.
3. The updated docs link to files that actually exist.
4. Existing repo checks still pass after the docs/scripts additions.

## Rollout Notes

- Do **not** make normal CI depend on VHS being installed.
- The checked-in GIFs are the published artifact; regeneration remains a documented manual step.
- If asset size becomes a problem, reduce the number of tapes before switching formats.

## Implementation Shape

Expected change surface for the first PR:

- new docs directory for VHS tapes and outputs
- new generation script
- small demo fixtures
- links from the existing scenarios index and covered detail pages

That keeps the work additive, reviewable, and easy to expand later.
