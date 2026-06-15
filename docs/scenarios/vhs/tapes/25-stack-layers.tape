Output docs/scenarios/vhs/output/25-stack-layers.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck layer create my-overrides"
Enter
Sleep 2500ms

Type "harnessdeck layer search foundation"
Enter
Sleep 2500ms

Type "harnessdeck project apply engineering-foundation my-overrides --dry-run"
Enter
Sleep 8000ms
