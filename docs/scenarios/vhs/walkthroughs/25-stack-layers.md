# Stack multiple layers

[![stack-layers demo](../output/25-stack-layers.gif)](../output/25-stack-layers.gif)

Tape: [../tapes/25-stack-layers.tape](../tapes/25-stack-layers.tape)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck project scan .`
3. `harnessdeck layer create my-overrides`
4. `harnessdeck layer search foundation`
5. `harnessdeck project apply engineering-foundation my-overrides --dry-run`
