Output docs/scenarios/vhs/output/09-history-revert.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck layer search foundation"
Enter
Sleep 2500ms

Type "harnessdeck project apply engineering-foundation"
Enter
Sleep 2500ms

Type "harnessdeck project history --project ."
Enter
Sleep 2500ms

Type "harnessdeck project status ."
Enter
Sleep 10000ms
