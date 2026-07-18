Output docs/scenarios/vhs/output/11-catalog-baseline.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnesstap

Type "harnesstap init --main codex --aliases claude-code,cursor"
Enter
Sleep 1500ms

Type "harnesstap layer list --search foundation --remote-only"
Enter
Sleep 2500ms

Type "harnesstap layer apply engineering-foundation"
Enter
Sleep 2500ms

Type "harnesstap status ."
Enter
Sleep 12000ms
