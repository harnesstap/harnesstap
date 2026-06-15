# Preview and apply a layer

Tape: [../tapes/07-preview-apply-layer.tape](../tapes/07-preview-apply-layer.tape)

[![Preview and apply demo](../output/07-preview-apply-layer.gif)](../output/07-preview-apply-layer.gif)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck layer search foundation`
3. `harnessdeck project apply engineering-foundation --project . --dry-run`
4. `harnessdeck project apply engineering-foundation --project .`
5. `harnessdeck project status .`
