Output docs/scenarios/vhs/output/23-validate-layer.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck layer create my-setup"
Enter
Sleep 2500ms

Type "harnessdeck layer doctor my-setup"
Enter
Sleep 2500ms

Type "harnessdeck layer doctor --list-checks"
Enter
Sleep 3000ms
