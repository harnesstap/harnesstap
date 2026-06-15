# Apply a curated deck

Walkthrough for [Scenario 29](../../details/29-apply-deck.md).

## Commands

1. `harnessdeck deck import ./team-deck` — load deck metadata and layer membership
2. `harnessdeck deck show team-platform` — review ordered layers and active environment
3. `harnessdeck deck apply team-platform --project . --dry-run`
4. `harnessdeck deck apply team-platform --project .`
5. `harnessdeck project status .`

Optional: `harnessdeck deck apply team-platform my-overrides --project .` to append override layers after the deck stack.
