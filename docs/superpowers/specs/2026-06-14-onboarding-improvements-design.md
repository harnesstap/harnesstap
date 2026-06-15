# Onboarding improvements design

**Date:** 2026-06-14  
**Status:** Approved for implementation  
**Related:** [CLI UX realignment](2026-06-11-cli-ux-realignment-design.md), [command reference](../../cli/command-reference.md)

## Problem

New engineers can reach value quickly (`init` → `project apply`), but three gaps slow adoption:

1. **Inconsistent quick-start examples** — `guide` uses `engineering-foundation` while README, scenario 11, and the VHS demo use `nextjs-fullstack`. Catalog search for `fullstack` does not surface `nextjs-fullstack`.
2. **Poor catalog search ranking** — API results sort by `updated`; substring matches in summaries/tags outrank exact slug matches.
3. **Steep concept curve** — resource / layer / deck / environment / harness vocabulary is not surfaced in the CLI; users must read README or SPEC.

`SPEC.md` still documents built-in layer seeding at `init`, which no longer happens.

## Goals

1. One canonical public-catalog baseline across docs and CLI hints: **`engineering-foundation`**.
2. Client-side search re-ranking: exact slug and name matches before tag/summary noise.
3. Post-`init` next steps that teach catalog browse + apply (search `foundation`, apply baseline).
4. **`hd concepts`** — one-screen glossary of core nouns and common command choices.
5. Fix SPEC init workflow bullet.

## Non-goals

- Shell completion (`hd completion`).
- Renaming or removing legacy catalog slugs such as `nextjs-fullstack`.
- Changing cloud API search behavior.
- Regenerating VHS GIF assets (tape + walkthrough text only).

## Decisions

| Topic | Decision |
| --- | --- |
| Canonical baseline | `engineering-foundation` |
| Canonical search hint | `foundation` |
| Apply in quick start | `project apply engineering-foundation --project .` (omit `--harness` when init set preferences) |
| Search ranking | Client-side in `listLayersInScope` when `q` is set |
| Concepts command | Top-level `concepts`, human text only (no flags) |

## Search ranking tiers

Lower rank = higher in results (ties break by `updatedAt` desc, then slug asc):

| Rank | Match |
| --- | --- |
| 0 | slug equals query (case-insensitive) |
| 1 | slug starts with query |
| 2 | display name equals query |
| 3 | display name contains query |
| 4 | slug contains query |
| 5 | tag equals query |
| 6 | tag contains query |
| 7 | summary contains query |
| 8 | no structured match (preserve API order among peers) |

## CLI changes

### `printQuickStartGuide` / `guide`

After `init` and in `hd guide`:

```
layer search foundation
project apply engineering-foundation --project .
concepts
guide
```

### `concepts`

Prints short definitions for: resource, layer, deck, environment, harness, main/alias harness, and when to use `project apply` vs `project mirror`, `layer pull` vs `layer combine`.

### Constants

`src/constants/onboarding.ts` exports `CANONICAL_CATALOG_BASELINE` and `CANONICAL_CATALOG_SEARCH_HINT` for CLI and tests.

## Documentation updates

- README demo + quick start + catalog baselines section
- Scenario 11
- VHS tape + walkthrough
- `docs/cli/command-reference.md` — `concepts` section
- `SPEC.md` — remove built-in seeding from init bullet

## Tests

- `test/services/catalog-search-rank.test.ts` — ranking tiers
- Update `help-organization.test.ts` — `concepts` output
- Update `vhs-scenarios.test.ts` — tape strings
- Optional: layer-cloud search order with mocked layers

## Success criteria

- `layer search foundation` lists `engineering-foundation` first among matches.
- All quick-start surfaces reference the same baseline slug.
- `hd concepts` and post-init output mention core vocabulary.
- `bun run preflight` passes.
