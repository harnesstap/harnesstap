# @inquirer/core 10.3.2 and @inquirer/search 3.2.2

## How the original uses it

- `@inquirer/core` (`createPrompt`, `useState`, `useKeypress`, `usePagination`,
  `useEffect` and others) builds three custom prompts in `src/services/wizards/`:
  `interactive-plugin-list-browse.ts`,
  `prompts/create-remote-catalog-list-prompt.ts` and
  `prompts/create-local-multi-select-prompt.ts`, plus `hooks/use-terminal-size.ts`.
- `@inquirer/search` backs the generic search prompt in `wizards/shared.ts`.
- `src/services/wizards/` holds about 4600 lines and is reached from `init`, `plugin`,
  `project`, `harness`, `environment`, `marketplace`, `migrate` and the profile commands.
  Every wizard is skipped with `--no-interactive` or off a TTY.

## What a port has to reproduce

- The text the prompts print: question line, help line, pagination, the selected
  answer echoed after submit, and the cancel behavior (Ctrl+C exits with the same
  code and message as the original).
- Key handling: arrows, tab, space and enter, typing to filter, and the loop and page
  sizes.
- ANSI output: compared after whitespace normalization, with color off in recorded cases
  (ADR-003).

## Crate options

- `inquire`: closest in spirit (select, multi-select, autocomplete), but its own layout,
  help text and key bindings. Not text-compatible.
- `dialoguer`: same problem, and no async search source.
- `crossterm` (+ `console` for widths): raw terminal input and output, used to write
  the prompts by hand.

## Recommendation

Port the prompts directly on `crossterm`. Write a tiny `create_prompt` loop (state, key
handler, render to a string) that mirrors `@inquirer/core`, because the custom prompts
are written against that model. `app record` cannot drive a TTY, so record each wizard with
`@inquirer/testing` in the original (keys in, screen frames out) and replay the same
keys against the Rust prompt in a pseudo-terminal (`portable-pty` or `expectrl`). This is wave 2
work. Until then the front door sends interactive runs to the original.
