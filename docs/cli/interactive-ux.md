# Interactive list keyboard guide

HarnessDeck's TTY browse and search prompts share one keyboard contract. A help line at the bottom of each prompt shows the keys available in that mode.

## Universal keys

These work in every interactive list prompt.

| Key | Behavior |
| --- | --- |
| ↑ / ↓ | Move the active item (stops at the first and last item) |
| Typeable characters | Append to the search query, including uppercase; active item resets to the top |
| Backspace | Delete the last query character; active item resets to the top |
| Esc in **detail** view | Return to the browse list (does not exit the prompt) |

## Modes

Each prompt runs in one of five modes. **Enter** and **Esc** behavior depends on the mode.

### `filter` — live search overlay

Used by: `resource list` interactive filter.

| Key | Behavior |
| --- | --- |
| Enter | Open detail view for the active item (when one exists) |
| Esc (browse) | **Commit** the current query and exit |

Esc always exits with whatever is typed. An empty query means "no filter" and shows the full list. Help label: `esc exit`.

**Display behavior:** The filter runs on an alternate terminal screen so typing and scrolling do not leave ghost lines in your scrollback. When you exit, the main screen is restored and the final filtered list prints normally. The table reflows when you resize the terminal.

**Columns:** NAME shows the bare resource name. NAMESPACE shows plugin or package provenance (marketplace-linked resources display as `marketplace/plugin`). Selectors and JSON output still use `name@namespace` where applicable.

**Viewport:** On height-constrained terminals, browse shows one resource type at a time with a sliding window of rows. Overflow hints fold onto one line when the terminal is wide enough (for example `↑ 7 above · ↓ 4 more in skill · plugin_pin (14) · ↓ next type`). Static `resource list --no-interactive` still prints all type sections.

**Search prefixes:** Type `skill:dbt` to filter skills whose names or descriptions contain `dbt`. Unknown prefixes are treated as plain text.

**Shortcuts:** `d` deletes the active row after an inline `[y/N]` confirm.

**Chrome:** Selection is shown only in the table (`>` marker and accent color). There is no separate `Active:` / `Show:` line above the table.

### `select-one` — pick one item

Used by: `resource show`, `resource delete`, `layer show`, `layer delete`, `profile show`, and `layer list` remote install.

| Key | Behavior |
| --- | --- |
| Enter | Confirm the active item and exit |
| `d` | Delete the active item (delete intents only; inline confirm) |
| Esc (browse) | **Cancel** the prompt |

Help label: `esc cancel`.

### `select-many` (wizard) — multi-select in a wizard step

Used by: wizard alias multi-select flows.

| Key | Behavior |
| --- | --- |
| Enter | Submit checked items |
| Esc (browse) | Go **back** to the previous wizard step |
| Space | Toggle the active item |
| Ctrl+A | Select all visible items |
| Ctrl+X | Clear selection on all visible items |

Help label: `esc back`.

### `select-many` (action) — multi-select with detail view

Used by: `layer list` catalog search (apply), `layer edit` interactive composition.

| Key | Behavior |
| --- | --- |
| Enter | Open detail view for the active item |
| Esc (browse) | **Cancel** the prompt |
| Ctrl+S | Submit checked items |
| Space | Toggle the active item |
| Ctrl+A | Select all visible items |
| Ctrl+X | Clear selection on all visible items |

When Enter opens a detail view, use **Ctrl+S** to save or apply — the same affordance as "save" in editors. Help label: `esc cancel`.

### `action-menu` — row actions with shortcuts

Used by: `environment edit`.

| Key | Behavior |
| --- | --- |
| Enter | Edit the active row |
| Esc (browse) | **Cancel** (returns without saving) |
| `a` | Add a row |
| `d` | Delete the active row |
| `q` | Quit and save |

## Help labels

Prompts use consistent labels so Esc behavior is predictable.

| Action | Help label |
| --- | --- |
| Commit filter and exit | `esc exit` |
| Cancel prompt | `esc cancel` |
| Wizard step back | `esc back` |
| Detail view back to browse | `esc back` |

## Tips

- **Uppercase search** — all prompts accept shift-modified characters in the query. Matching is case-insensitive.
- **Disable interactivity** — pass `--no-interactive` on supported commands for scripting and CI.
- **JSON output** — many list commands accept `--format json` as a non-interactive alternative.

## Related

- [Command reference](./command-reference.md) — `layer list`, `resource list`, `layer edit`, and other commands that use these prompts
- [Getting started](./getting-started.md) — first-run workflow
