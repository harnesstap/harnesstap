# Preview and apply a plugin

Tape: [../tapes/07-preview-apply-plugin.tape](../tapes/07-preview-apply-plugin.tape)

[![Preview and apply demo](../output/07-preview-apply-plugin.gif)](../output/07-preview-apply-plugin.gif)

## Commands

1. `ht init --main codex --aliases claude-code,cursor`
2. `ht plugin list --search foundation --remote-only`
3. `ht apply engineering-foundation --dry-run`
4. `ht apply engineering-foundation`
5. `ht status .`
