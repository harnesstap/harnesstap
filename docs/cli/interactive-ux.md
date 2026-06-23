# Interactive list keyboard guide

HarnessDeck's TTY entity lists share one **table browser**: grouped tables, a search line, a dense folded footer, and a help line. Selection is shown only in the table (`>` marker and accent color)—there is no separate `Active:` / `Show:` line above the table.

## Universal keys

These work in every interactive table browser prompt.

| Key | Behavior |
| --- | --- |
| ↑ / ↓ | Move the active item (stops at the first and last item) |
| Typeable characters | Append to the search query, including uppercase; active item resets to the top |
| Backspace | Delete the last query character; active item resets to the top |
| Esc in **detail** view | Return to the browse list (does not exit the prompt) |

## Chrome

Every browse frame follows the same layout:

```
? Filter resources
Search: skill:dbt

skill (3)
┌──────────┬───────────┬─────────┐
│ NAME     │ NAMESPACE │ UPDATED │
├──────────┼───────────┼─────────┤
│ > beta   │ …         │ 1d ago  │
└──────────┴───────────┴─────────┘
  ↑ 7 above · ↓ 4 more in skill · rule (1) · ↓ next type

↑↓ select · type search · ⏎ show · d delete · esc exit
```

**Folded footer:** When rows or sections overflow the viewport, hint segments join with ` · ` on one line when the terminal is wide enough (for example `↑ 7 above · ↓ 4 more in skill · rule (1) · ↓ next type`). On narrow terminals, segments wrap at ` · ` boundaries onto additional indented lines.

**Display behavior:** Filter and pick prompts run on an alternate terminal screen so typing and scrolling do not leave ghost lines in your scrollback. When you exit, the main screen is restored. Tables reflow when you resize the terminal.

## Search prefixes

Type `section:text` to scope search to a section or column family. Unknown prefixes are treated as plain text.

| Prefix | Used by | Matches |
| --- | --- | --- |
| `skill:dbt` | Resource list | Skills whose name or description contains `dbt` |
| `rule:api` | Resource list | Rules matching `api` |
| `name:prod` | Environment list | Environment names |
| `desc:staging` | Environment list | Environment descriptions |
| `local:foo` | Layer / profile list | Locally installed layers |
| `remote:full` | Layer / profile list | Remote catalog layers |

Free text (no prefix) matches across the default fields for that list.

## Intents

Each prompt runs with one **intent**. **Enter** and **Esc** behavior depends on the intent.

### `filter` — live search overlay

Used by: `resource list`, `environment list` (interactive `env ls`).

| Key | Behavior |
| --- | --- |
| Enter | Open detail view for the active item (when one exists) |
| Esc (browse) | **Commit** the current query and exit |
| `d` | Delete the active row after an inline `[y/N]` confirm (resources only) |

Esc always exits with whatever is typed. An empty query means "no filter" and shows the full list. Help label: `esc exit`.

**Resource columns:** NAME shows the bare resource name. NAMESPACE shows plugin or package provenance (marketplace-linked resources display as `marketplace/plugin`). Selectors and JSON output still use `name@namespace` where applicable.

**Resource viewport:** On height-constrained terminals, browse shows one resource type at a time with a sliding window of rows. Static `resource list --no-interactive` still prints all type sections.

**Environment columns:** NAME, VALUES, SECRETS, REFS counts.

### `pick-one` — pick one item

Used by: `resource show`, `resource delete`, `layer show`, `layer delete`, `profile show`, `environment show`, `environment delete`.

| Key | Behavior |
| --- | --- |
| Enter | Confirm the active item and exit |
| `d` | Delete the active item (delete intents only; inline confirm) |
| Esc (browse) | **Cancel** the prompt |

Help label: `esc cancel`.

### `pick-many` — multi-select with detail view

Used by: `layer edit` interactive composition, catalog search apply (`layer list` apply mode).

| Key | Behavior |
| --- | --- |
| Enter | Open detail view for the active item |
| Esc (browse) | **Cancel** the prompt |
| Ctrl+S | Submit checked items |
| Space | Toggle the active item |
| Ctrl+A | Select all visible items |
| Ctrl+X | Clear selection on all visible items |

When Enter opens a detail view, use **Ctrl+S** to save or apply. Help label: `esc cancel`.

### `install` — pick a remote catalog layer

Used by: `layer list` remote install, catalog browser.

| Key | Behavior |
| --- | --- |
| Enter | Install the active remote layer (or show local layer details) |
| Esc (browse) | **Cancel** the prompt |

Help label: `esc cancel`.

### `manage` — row actions with shortcuts

Used by: `environment edit`.

| Key | Behavior |
| --- | --- |
| Enter | Edit the active row |
| Esc (browse) | **Cancel** (returns without saving) |
| `a` | Add a row |
| `d` | Delete the active row |
| `q` | Quit and save |

Help label: `esc cancel`.

### Wizard multi-select (legacy)

Used by: wizard alias multi-select flows (`promptForSearchableMultiSelect`).

| Key | Behavior |
| --- | --- |
| Enter | Submit checked items |
| Esc (browse) | Go **back** to the previous wizard step |
| Space | Toggle the active item |
| Ctrl+A | Select all visible items |
| Ctrl+X | Clear selection on all visible items |

Help label: `esc back`.

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

- [Command reference](./command-reference.md) — `layer list`, `resource list`, `environment list`, `layer edit`, and other commands that use these prompts
- [Getting started](./getting-started.md) — first-run workflow
