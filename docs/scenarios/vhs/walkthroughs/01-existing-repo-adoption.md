# Adopt HarnessTap in an existing repository

This walkthrough demonstrates adopting HarnessTap in a repository that already
contains project files (the `scan-project` fixture). It covers the full flow from
initialisation through applying a plugin and confirming the final state.

[![existing-repo-adoption demo](../output/01-existing-repo-adoption.gif)](../output/01-existing-repo-adoption.gif)

Tape: [../tapes/01-existing-repo-adoption.tape](../tapes/01-existing-repo-adoption.tape)

## Commands

1. `ht init --main codex --aliases claude-code,cursor` — initialise HarnessTap and set harness preferences
2. `ht scan .` — detect existing resources
3. `ht resource list` — review discovered resources
4. `ht plugin list --search foundation --remote-only` — browse catalog plugins
5. `ht apply engineering-foundation` — apply a catalog plugin to the project
6. `ht status .` — confirm the final state
