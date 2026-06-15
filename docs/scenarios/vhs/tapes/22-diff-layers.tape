Output docs/scenarios/vhs/output/22-diff-layers.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck layer create team-baseline"
Enter
Sleep 2500ms

Type "harnessdeck layer create my-fork"
Enter
Sleep 2500ms

Type "harnessdeck layer diff team-baseline my-fork"
Enter
Sleep 3000ms
