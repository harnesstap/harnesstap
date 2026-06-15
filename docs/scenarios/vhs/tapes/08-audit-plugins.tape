Output docs/scenarios/vhs/output/08-audit-plugins.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck resource list --type plugin"
Enter
Sleep 2500ms

Type "harnessdeck layer create my-setup"
Enter
Sleep 2500ms

Type "harnessdeck layer show my-setup"
Enter
Sleep 3000ms
