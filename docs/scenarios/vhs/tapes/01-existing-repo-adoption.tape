Output docs/scenarios/vhs/output/01-existing-repo-adoption.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require ht

Type "ht init"
Enter
Sleep 1500ms

Type "ht scan ."
Enter
Sleep 3000ms

Type "ht resource list"
Enter
Sleep 3000ms

Type "ht layer list --search foundation --remote-only"
Enter
Sleep 3000ms

Type "ht layer apply engineering-foundation"
Enter
Sleep 3000ms

Type "ht status ."
Enter
Sleep 20000ms
