Output docs/scenarios/vhs/output/28-machine-migration.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck migrate export ./harnessdeck-state.tar.gz"
Enter
Sleep 2500ms

Type "harnessdeck migrate import ./harnessdeck-state.tar.gz"
Enter
Sleep 8000ms
