# CLI Review

This document introduce a review of differents issues in the CLI. It's sharing insights to solve them.

## General issues

- When failing a command, we should few example of usage along options that are available. We should keep the error message of course as the first part but add the details in a secondary part.

- To reduce help verbosity, we should hide the "[options]" as it's implicit that we support options.

## Init command

- If the environment has already be inialized:
  - put a quick warning that it will be overriden
  - show current defaults (main/alias harnesses) when selecting them
- add a search for both main / alias harnesses selection hotkey
- add a select all / select none hotkeys 
- add a auto-detect: if a single harness is available, place the cursor on it automatically
- for aliases preselect all installed/detected harnesses
- `Built-in Presets      already up to date` doesn't look like worth it? I feel like we want to load remote presets but only when listing them
- 

## Preset Commands

- `hd p show` should show the existing preset list to select the one to show the details
- ```hd p import python-fastapi.harnessdeck.jsonc 
✗ UNIQUE constraint failed: presets.name, presets.version
```
=> we should have a clearer message to say that it already exists. And if it exists, we should ask the user to overwrite existing preset or not.

- `hd p search` I expect the search to be dynamic: we should ask the query interactively if not provided. Then in that interactive mode, we should give some example of search (e.g. regex support).

- Rename `hd p install [options] <selector>` to `hd p add [options] <selector>`
- `add [options] <selector>` should support selecting an org like `hd p my-preset@myorg`

- publish command should allow to specify the org or let the user choose it interactively when connected to an account with multiple orgs

- `hd p doctor` should show all the checks that are performed and with a check emoji if working as intended or a cross emoji if not.

- hd p from-project should show [preset name] in description and say in the `hd p` that we write the description: "Scan current folder and create a preset from its resources"
