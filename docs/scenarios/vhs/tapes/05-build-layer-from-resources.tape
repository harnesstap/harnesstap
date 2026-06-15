Output docs/scenarios/vhs/output/05-build-layer-from-resources.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck layer create my-setup --description 'Shared project assistant setup'"
Enter
Sleep 2500ms

Type "harnessdeck resource list"
Enter
Sleep 2500ms

Type "harnessdeck layer show my-setup"
Enter
Sleep 3000ms
