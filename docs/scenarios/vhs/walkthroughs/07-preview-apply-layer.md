# Preview and apply a layer

Tape: [../tapes/07-preview-apply-layer.tape](../tapes/07-preview-apply-layer.tape)

[![Preview and apply demo](../output/07-preview-apply-layer.gif)](../output/07-preview-apply-layer.gif)

## Commands

1. `harnessdeck init --main codex --aliases claude-code,cursor`
2. `harnessdeck layer list --search foundation --remote-only`
3. `harnessdeck layer apply engineering-foundation --dry-run`
4. `harnessdeck layer apply engineering-foundation`
5. `harnessdeck status .`
