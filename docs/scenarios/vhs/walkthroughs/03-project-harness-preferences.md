# Override harness preferences for one repository

[![project-harness-preferences demo](../output/03-project-harness-preferences.gif)](../output/03-project-harness-preferences.gif)

Tape: [../tapes/03-project-harness-preferences.tape](../tapes/03-project-harness-preferences.tape)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck harness project set --project . --main codex --aliases claude-code,cursor`
3. `harnessdeck harness project status --project .`
