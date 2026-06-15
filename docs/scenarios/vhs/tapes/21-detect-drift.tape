Output docs/scenarios/vhs/output/21-detect-drift.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck layer search foundation"
Enter
Sleep 2500ms

Type "harnessdeck project apply engineering-foundation"
Enter
Sleep 2500ms

Type "harnessdeck project drift --project ."
Enter
Sleep 10000ms
