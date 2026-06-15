Output docs/scenarios/vhs/output/03-project-harness-preferences.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck harness project set --project . --main codex --aliases claude-code,cursor"
Enter
Sleep 2500ms

Type "harnessdeck harness project status --project ."
Enter
Sleep 3000ms
