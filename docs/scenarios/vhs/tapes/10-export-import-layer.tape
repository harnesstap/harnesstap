Output docs/scenarios/vhs/output/10-export-import-layer.gif
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

Type "harnessdeck layer export my-setup --file ./my-setup.harnessdeck.toml"
Enter
Sleep 2500ms

Type "harnessdeck layer import ./my-setup.harnessdeck.toml"
Enter
Sleep 3000ms
