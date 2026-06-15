Output docs/scenarios/vhs/output/13-materialization-strategy.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnessdeck harness project set --project . --materialization-strategy symlink-preferred"
Enter
Sleep 2500ms

Type "harnessdeck harness project status --project ."
Enter
Sleep 3000ms
