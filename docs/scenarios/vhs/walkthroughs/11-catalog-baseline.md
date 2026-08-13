# Start from a catalog baseline

Apply a public catalog plugin as a starting point instead of composing one from scratch.

[![Catalog baseline demo](../output/11-catalog-baseline.gif)](../output/11-catalog-baseline.gif)

Tape: [../tapes/11-catalog-baseline.tape](../tapes/11-catalog-baseline.tape)

## Commands

1. `ht init --main codex --aliases claude-code,cursor` — initialise HarnessTap and set harness preferences
2. `ht plugin list --search foundation --remote-only` — browse catalog plugins
3. `ht apply engineering-foundation` — fetch and apply the catalog baseline
4. `ht status .` — confirm the final state
