# cli-table3 0.6.5

## How the original uses it

Only through `src/ui/table.ts` (13 callers in `src/`). `renderTable` computes the column
widths itself (`computeColumnWidths`: `width`, `minWidth`, `widthShare`, `fitContent`,
the max width from the TTY or 100 off a TTY), pre-truncates cells with
`truncateTableCell`, and then builds a `new Table` with:

- `head`, `colWidths`, `chars: getTableChars()` (box drawing or ASCII from `theme.ts`);
- `truncate: "..."`, `style: { head: [], border: [] }` (no colors from the table itself);
- optionally `wordWrap` and `wrapOnWordBoundary`.

No call uses `colSpan`, `rowSpan`, `hAlign`, `vAlign` or cell objects.

## What a port has to reproduce

- cli-table3's layout for that subset: `layout-manager.js`, the parts of `cell.js` that
  draw borders, padding (1 on each side) and lines, and `utils.js` (`strlen`, `truncate`,
  `wordWrap`, `hardWrap`, `colorizeLines`), about 600 lines.
- Width measurement: cli-table3 measures with `string-width` 4 after stripping ANSI
  codes. `unicode-width` differs on some emoji and East Asian ambiguous characters, so
  the port measures with the same tables (`string-width` 4 rules: `is-fullwidth-code-point`
  plus `emoji-regex`) to keep wrapping identical.
- ANSI styles applied by `col.style` survive wrapping (`colorizeLines` reopens them on each
  line).

## Crate options

- `comfy-table`, `tabled`, `prettytable-rs`: their own width distribution and wrapping.
  None reproduces cli-table3's lines.

## Recommendation

Hand port the subset as one module of the shared UI crate, together with `src/ui/table.ts`
and `theme.ts`. Pin it with fixtures recorded from `renderTable` (generated rows, widths,
wrap and truncate options, ASCII and Unicode chars, ANSI styled cells). The `ht ... list`
cases in `rust/app-cases` cover the real callers.
