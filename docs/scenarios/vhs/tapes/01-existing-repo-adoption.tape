Output docs/scenarios/vhs/output/01-existing-repo-adoption.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require harnessdeck

Type "harnessdeck init"
Enter
Sleep 1500ms

Type "harnessdeck project scan ."
Enter
Sleep 3000ms

Type "harnessdeck resource list"
Enter
Sleep 3000ms

Type "harnessdeck layer list"
Enter
Sleep 3000ms

Type "harnessdeck project apply nextjs-fullstack --project . --harness codex"
Enter
Sleep 3000ms

Type "harnessdeck project status ."
Enter
Sleep 20000ms
