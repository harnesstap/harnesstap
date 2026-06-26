# Start from a catalog baseline

Tape: [../tapes/11-catalog-baseline.tape](../tapes/11-catalog-baseline.tape)

[![Catalog baseline demo](../output/11-catalog-baseline.gif)](../output/11-catalog-baseline.gif)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck layer list --search foundation --remote-only`
3. `harnessdeck layer apply engineering-foundation`
4. `harnessdeck status .`
