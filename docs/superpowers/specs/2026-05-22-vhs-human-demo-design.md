# VHS human-centered demo redesign

## Summary

Replace the current multi-scenario VHS pack with a single long walkthrough that
matches how a human is likely to evaluate HarnessDeck in a real repository.

The new demo should tell one continuous adoption story:

1. initialize HarnessDeck
2. scan the current repository
3. inspect imported resources
4. inspect available presets
5. apply a useful built-in preset
6. review the resulting tracked project state

The rendered GIF from that walkthrough should become the primary visual demo in
the root `README.md`.

## Problem

The current VHS assets optimize for scenario coverage, not for a believable
human narrative. Several of the chosen clips are useful as command coverage, but
they do not reflect how a new user is most likely to explore the tool on a real
repository. The result is a set of short, fragmented demos rather than one
coherent walkthrough.

## Goals

- Show a realistic first-use repository adoption flow.
- Use only human-readable visible commands and outputs.
- Avoid JSON output in the visible tape.
- Keep the visible demo centered on `harnessdeck` commands rather than setup.
- Embed the generated GIF in the root `README.md`.
- Preserve checked-in VHS assets and automated regression coverage.

## Non-goals

- Cover every important HarnessDeck scenario in the main GIF.
- Demonstrate maintenance workflows such as drift detection or project sync.
- Preserve the current per-scenario VHS demo pack structure.

## User story

The demo should feel like a person cloned a repo, wants to understand what
HarnessDeck can do for that repo, and then adopts a built-in preset. It should
avoid power-user or maintenance workflows that usually happen later.

## Walkthrough design

The visible tape should show this exact story:

1. `harnessdeck init`
2. `harnessdeck project scan .`
3. `harnessdeck resource list`
4. `harnessdeck preset list`
5. `harnessdeck project apply nextjs-fullstack --project . --platform codex`
6. `harnessdeck project status .`

Constraints:

- The first visible command must be `harnessdeck init`.
- The tape must not show JSON output flags.
- The tape must not show setup commands such as `cd`, exported environment
  variables, or direct `node dist/index.js` usage.
- The final screen must stay visible long enough for a human to read.

## Repository changes

### VHS assets

- Keep a single manifest entry for the new walkthrough.
- Keep one checked-in tape in `docs/scenarios/vhs/tapes/`.
- Keep one checked-in GIF in `docs/scenarios/vhs/output/`.
- Continue to generate the tape through the existing `docs:vhs` workflow.

### Documentation

- Update `docs/scenarios/vhs/README.md` to describe one long walkthrough instead
  of a table of scenario clips.
- Update the root `README.md` to embed the generated GIF as the primary demo.
- Remove per-scenario VHS demo links from scenario detail pages, because the
  per-scenario GIFs and tapes will no longer exist.

## Rendering and fixture strategy

- Reuse the current generator script and wrapper approach so visible commands are
  still `harnessdeck`.
- Hidden setup remains allowed only for preparing the fixture repository and
  demo execution environment.
- The visible walkthrough should start directly with the first real
  `harnessdeck` command.
- The fixture repository should support the adoption story without requiring
  JSON-mode inspection or post-apply maintenance flows.

## Testing

Regression coverage should assert:

- exactly one VHS manifest entry exists
- the single tape starts with `harnessdeck init`
- visible commands stay human-readable and use no JSON flags
- setup commands remain hidden
- the tape preserves the human-readable timing requirements
- README/docs links point at the single generated GIF and tape where applicable

## Rollout

1. Replace the current VHS manifest/tape/output set with the new walkthrough.
2. Regenerate the GIF artifact.
3. Update README/docs links to point at the new demo.
4. Update regression tests to reflect the single-demo model.
