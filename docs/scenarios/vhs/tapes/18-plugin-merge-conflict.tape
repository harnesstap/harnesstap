Output docs/scenarios/vhs/output/18-plugin-merge-conflict.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan . --harness claude-code"
Enter
Sleep 2500ms

Type "harnessdeck resource list --type plugin"
Enter
Sleep 3000ms
