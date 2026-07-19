Output docs/scenarios/vhs/output/01-existing-repo-adoption.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnesstap

Type "harnesstap init"
Enter
Sleep 1500ms

Type "harnesstap scan ."
Enter
Sleep 3000ms

Type "harnesstap resource list"
Enter
Sleep 3000ms

Type "harnesstap layer list --search foundation --remote-only"
Enter
Sleep 3000ms

Type "harnesstap layer apply engineering-foundation"
Enter
Sleep 3000ms

Type "harnesstap status ."
Enter
Sleep 20000ms
