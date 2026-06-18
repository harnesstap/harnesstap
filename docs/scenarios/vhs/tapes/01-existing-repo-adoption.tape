Output docs/scenarios/vhs/output/01-existing-repo-adoption.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck scan ."
Enter
Sleep 3000ms

Type "harnessdeck resource list"
Enter
Sleep 3000ms

Type "harnessdeck layer search foundation"
Enter
Sleep 3000ms

Type "harnessdeck layer apply engineering-foundation"
Enter
Sleep 3000ms

Type "harnessdeck status ."
Enter
Sleep 20000ms
