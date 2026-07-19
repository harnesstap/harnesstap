# Start from a catalog baseline

Tape: [../tapes/11-catalog-baseline.tape](../tapes/11-catalog-baseline.tape)

[![Catalog baseline demo](../output/11-catalog-baseline.gif)](../output/11-catalog-baseline.gif)

## Commands

1. `harnesstap init --main codex --aliases claude-code,cursor`
2. `harnesstap layer list --search foundation --remote-only`
3. `harnesstap layer apply engineering-foundation`
4. `harnesstap status .`
