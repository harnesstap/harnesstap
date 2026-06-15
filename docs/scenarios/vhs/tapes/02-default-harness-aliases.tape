Output docs/scenarios/vhs/output/02-default-harness-aliases.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck harness set --main claude-code --aliases cursor,codex"
Enter
Sleep 2500ms

Type "harnessdeck harness status"
Enter
Sleep 3000ms
