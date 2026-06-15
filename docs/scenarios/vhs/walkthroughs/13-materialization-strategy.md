# Choose a materialization strategy

[![materialization-strategy demo](../output/13-materialization-strategy.gif)](../output/13-materialization-strategy.gif)

Tape: [../tapes/13-materialization-strategy.tape](../tapes/13-materialization-strategy.tape)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck harness project set --project . --materialization-strategy symlink-preferred`
3. `harnessdeck harness project status --project .`
