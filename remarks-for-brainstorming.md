# HarnessDeck Brainstorming Notes

- I feel like we could brand the CLI as a "Agent harness context management tool" while the product cloud experience (HarnessDeck Cloud) is going to be the "Agent harness context management platform". Does it makes sense?
- The project definition requires a git based project but I'm not sure it should be required.
- Spec / Readme lacks diagrams like mermaid diagrams to explain the relationship between the different concepts.
- The concepts are missing some parts: there's the preset definition but not the bundle. Is it a bundle of presets? We could make it clearer.
- I wonder if having the whole configuration in the database is a good idea: I feel like we could have references in a central file ~/.harnessdeck/config.yml but store the definitions of preset in separate yaml files to make it easier to modify its content without depending entirely on the CLI. I feel like the performance would be good enough compared to a full database while keeping it easy to maintain.
- We should prefer YML files over JSON files for the configuration and the presets.

## Commands

I feel like we could make `init` command implicit: on the first usage, before we run any command, we check if the database is not initialized and if it's not, we run `init` command. Then we follow up with the expected command.
We could still make a `harnessdeck config reset` command to replace current behavior. Also `harnessdeck config show` command to show the current configuration. Also `harnessdeck config set` command to set the current configuration.

Instead of `migrate` I would prefer a `backup` command as it's clearer I guess?

`harnessdeck platform list` could be collapsed into `harnessdeck harness supported` as it's more clear.

I feel like `harnessdeck plugin ...` should be under `harnessdeck resource ...` as plugins are resources too.

`harnessdeck preset add-plugin` / `harnessdeck preset remove-plugin` / `harnessdeck preset add-dependency` / `harnessdeck preset remove-dependency` could be collapsed under `harnessdeck preset add` and `harnessdeck preset remove` commands? 

I feel like we should support interactive mode for commands like `harnessdeck preset add` and `harnessdeck preset remove` or `harnessdeck preset delete`. In that case, it would act as a wizard to add / remove / delete where we would guide the user through the different options needed. Of course, we would still support non-interactive mode by passing the flags and arguments.
We could probably do the same for most commands.

`harnessdeck preset search/install/publish` are probably not relevant anymore if we can combine them with the cloud equivalent ones?

Instead `harnessdeck preset validate`, I would suggest `harnessdeck preset doctor` that would run a series of checks to ensure the preset is valid. If no args, it's interactive mode where user can select a specific one or all.

Overall all the commands should have a hotkey for "select all/none" and "search".

I think we should introduce shorthands for the commands:
- `harnessdeck p` for `harnessdeck preset`
- `harnessdeck r` for `harnessdeck resource`
- `harnessdeck h` for `harnessdeck harness`
- `harnessdeck c` for `harnessdeck cloud`
- `harnessdeck pr` for `harnessdeck project`

`resource`, `project` and `harness` should also support the interactive mode to be guided.