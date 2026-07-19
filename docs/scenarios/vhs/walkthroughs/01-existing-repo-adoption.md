# Adopt HarnessTap in an existing repository

This walkthrough demonstrates adopting HarnessTap in a repository that already
contains project files (the `scan-project` fixture). It covers the full flow from
initialisation through applying a layer and confirming the final state.

[![existing-repo-adoption demo](../output/01-existing-repo-adoption.gif)](../output/01-existing-repo-adoption.gif)

Tape: [../tapes/01-existing-repo-adoption.tape](../tapes/01-existing-repo-adoption.tape)

## Commands

1. `harnesstap init` — initialise HarnessTap in the repository
2. `harnesstap scan .` — detect existing resources
3. `harnesstap resource list` — review discovered resources
4. `harnesstap layer list --search foundation --remote-only` — browse catalog layers
5. `harnesstap layer apply engineering-foundation` — apply a layer
6. `harnesstap status .` — confirm the final state
