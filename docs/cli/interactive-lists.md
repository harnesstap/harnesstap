# Interactive list keyboard reference

HarnessDeck’s TTY browse and search prompts share a single keyboard contract. Help lines at the bottom of each prompt reflect the mode-specific behavior documented here.

## Universal key bindings

| Key | Behavior |
| --- | --- |
| ↑ / ↓ | Move the active item (clamped at bounds; no wrap unless `loop: true`) |
| Typeable characters | Append to the search query (including uppercase); reset active index to 0 |
| Backspace (⌫) | Delete the last query character; reset active index to 0 |
| Esc in **detail** view | Return to browse (never exit the prompt) |

## By-mode behavior

| Mode | Prompts | Enter (browse) | Esc (browse) | Multi-select extras |
| --- | --- | --- | --- | --- |
| `filter` | `resource list` interactive filter | Open detail (if item) | **Commit** query and exit | — |
| `select-one` | `layer list` catalog browser (install) | Confirm selection and exit | **Cancel** (`ExitPromptError`) | — |
| `select-many` (wizard) | Wizard alias multi-select | Submit checked items | **Back** (`PromptBackError`) | Space toggle; Ctrl+A all visible; Ctrl+X none visible |
| `select-many` (action) | `layer list` catalog search (apply), `layer edit` | Open detail | **Cancel** (`ExitPromptError`) | Space toggle; Ctrl+A/X; **Ctrl+S submit** |
| `action-menu` | `environment edit` | Edit active row | **Cancel** (soft result) | `a` add, `d` delete, `q` quit save |

## Standardized help labels

| Internal action | Help label |
| --- | --- |
| Commit filter | `esc exit` |
| Cancel prompt | `esc cancel` |
| Wizard back | `esc back` |
| Detail back | `esc back` |

## Resolved decisions

### Resource list: Esc commits the filter

In `filter` mode, Esc always exits with the current query. An empty query means “no filter” and shows the full list. This matches incremental-search overlays (e.g. `less` `/pattern`) where exiting applies whatever is typed. Help text uses `esc exit`, not `esc cancel`. Callers must not treat a successful `{ query: "" }` as cancellation.

### Submit key: Enter vs Ctrl+S

When Enter opens a detail view, submit uses **Ctrl+S** instead:

| Prompt kind | Submit | Enter in browse |
| --- | --- | --- |
| Wizard multi-select (no detail view) | **Enter** | N/A (toggle is Space) |
| Catalog search apply, layer edit | **Ctrl+S** | Opens detail |

### Shift-key search

All prompts accept shift-modified printable keys in the search query. Filtering is case-insensitive in matchers; users may type uppercase for acronyms or habit.

## Related

- [Command reference](command-reference.md) — `layer list`, `resource list`, and other commands that use these prompts
