Output docs/scenarios/vhs/output/15-subset-platforms.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck layer search foundation"
Enter
Sleep 2500ms

Type "harnessdeck project apply engineering-foundation --dry-run --harness claude-code,codex"
Enter
Sleep 2500ms

Type "harnessdeck project apply engineering-foundation --harness claude-code,codex"
Enter
Sleep 10000ms
