# Apply to a subset of target platforms

[![subset-platforms demo](../output/15-subset-platforms.gif)](../output/15-subset-platforms.gif)

Tape: [../tapes/15-subset-platforms.tape](../tapes/15-subset-platforms.tape)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck layer search foundation`
3. `harnessdeck project apply engineering-foundation --dry-run --harness claude-code,codex`
4. `harnessdeck project apply engineering-foundation --harness claude-code,codex`
