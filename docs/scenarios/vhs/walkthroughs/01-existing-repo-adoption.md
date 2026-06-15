# Adopt HarnessDeck in an existing repository

This walkthrough demonstrates adopting HarnessDeck in a repository that already
contains project files (the `scan-project` fixture). It covers the full flow from
initialisation through applying a layer and confirming the final state.

[![existing-repo-adoption demo](../output/01-existing-repo-adoption.gif)](../output/01-existing-repo-adoption.gif)

Tape: [../tapes/01-existing-repo-adoption.tape](../tapes/01-existing-repo-adoption.tape)

## Commands

1. `harnessdeck init` — initialise HarnessDeck in the repository
2. `harnessdeck project scan .` — detect existing resources
3. `harnessdeck resource list` — review discovered resources
4. `harnessdeck layer search foundation` — browse catalog layers
5. `harnessdeck project apply engineering-foundation` — apply a layer
6. `harnessdeck project status .` — confirm the final state
