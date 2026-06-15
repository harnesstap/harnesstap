Output docs/scenarios/vhs/output/27-project-sync.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck project mirror . --dry-run"
Enter
Sleep 8000ms
