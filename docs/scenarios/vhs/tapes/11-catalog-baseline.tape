Output docs/scenarios/vhs/output/11-catalog-baseline.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck layer list --search foundation --remote-only"
Enter
Sleep 2500ms

Type "harnessdeck layer apply engineering-foundation"
Enter
Sleep 2500ms

Type "harnessdeck status ."
Enter
Sleep 12000ms
