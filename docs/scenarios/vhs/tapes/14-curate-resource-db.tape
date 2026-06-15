Output docs/scenarios/vhs/output/14-curate-resource-db.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 2500ms

Type "harnessdeck resource list --type skill"
Enter
Sleep 2500ms

Type "harnessdeck resource list --type instruction"
Enter
Sleep 3000ms
