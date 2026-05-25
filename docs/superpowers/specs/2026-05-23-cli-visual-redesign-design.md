# CLI Visual Redesign Design

## Problem

`harnessdeck` has a consistent command contract (see [2026-04-28-cli-ux-design.md](2026-04-28-cli-ux-design.md)) but its human-mode rendering is uneven and visually noisy.

- Every list row, every diff entry, and most narrative lines route through `log.info`, so the screen fills with blue `ℹ ` glyphs that carry no information.
- Each list command invents its own column order, padding, and prefix. There is no shared list/table primitive.
- Detail views (`*-show`, `*-status`) use three unrelated styles: bare `console.log(\`Type: …\`)`, `chalk.bold("ref:")`, and the `printInitMeta` helper.
- Section headers are inconsistent — some bold, some uppercase, some absent.
- Diff and drift output uses plain bullets with no color per change kind.
- The `init` command alone uses a polished hex palette and badge style; nothing else in the CLI uses that language.
- Long-running operations (`project scan`, `project apply`, `plugin update`) produce no progress indication and dump all output at the end.
- Help output is commander's default — plain, ungrouped, no color.

The goal is to give the entire CLI a single coherent visual language while preserving the existing command contract and JSON output.

## Goals

- Replace ad-hoc rendering with a small, focused `src/ui/` module.
- Apply one design language to every command's human output.
- Keep JSON output completely unchanged.
- Respect `NO_COLOR`, `--no-color`, and non-TTY environments.
- Migrate incrementally; keep `bun run preflight` green between phases.

## Non-Goals

- Changing JSON output for any command.
- Changing the command tree, flags, exit codes, or selector behavior.
- Adding interactive UI (TUI, prompt menus) beyond the existing `inquirer` flows.
- Syntax-highlighting `resource show --content` output.
- Replacing `commander` or any other top-level dependency.

## Visual Language

### Palette

Six semantic roles plus diff variants. No call site uses raw hex literals; everything goes through `theme.*`.

| Role | Style | Used for |
|---|---|---|
| `primary` | `chalk.bold` | titles, section headers |
| `accent` | `chalk.hex("#3b82f6")` | currently-active items, highlights |
| `muted` | `chalk.hex("#6b7280")` | labels, IDs, chrome, table borders, hints |
| `success` | `chalk.hex("#10b981")` | ✓ states |
| `warn` | `chalk.hex("#f59e0b")` | ⚠ states |
| `danger` | `chalk.hex("#ef4444")` | ✗ states |
| `badge` | `chalk.bgHex("#1d4ed8").white.bold` | the platform pill used in `init` |
| diff `added` | `success` + `+` | added rows |
| diff `removed` | `danger` + `−` | removed rows |
| diff `modified` | `warn` + `~` | modified rows |

### Icons

| Glyph | Meaning |
|---|---|
| `✓` | success verdict |
| `⚠` | warning verdict |
| `✗` | error verdict |
| `→` | next-step hint |
| `·` | inline separator in summary footers |
| `+` `−` `~` | diff change kinds |

`ℹ` is removed. The current overuse of `log.info` on every list row is the single biggest visual problem; in the new design, list rows live inside a table and need no prefix.

### Output Shapes

Six shapes cover the whole CLI.

**1. List** — boxed table, uppercase muted column names, optional 1-line summary footer.

```
┌──────────────────┬────────────────────────────────────────────┐
│ NAME             │ DESCRIPTION                                │
├──────────────────┼────────────────────────────────────────────┤
│ nextjs-fullstack │ Next.js 15 fullstack app with TypeScript…  │
│ python-fastapi   │ FastAPI REST API with SQLAlchemy, Pydan…   │
└──────────────────┴────────────────────────────────────────────┘
2 presets · run `harnessdeck preset show <name>` for details
```

**2. Detail** — `panel` with uppercase muted title, key/value block (14-char label padding), optional sub-tables.

```
PRESET  nextjs-fullstack

  Description   Next.js 15 fullstack app with TypeScript, Tailwind…
  Tags          nextjs, react, typescript
  ID            01KSAV…WSCK
  Resources     4 (1 instruction, 3 rules)
  Updated       2 days ago

RESOURCES
┌─────────────┬──────────────────┬────────────┐
│ TYPE        │ NAME             │ ID         │
├─────────────┼──────────────────┼────────────┤
│ instruction │ project-context  │ 01KSAV…7M  │
│ rule        │ react-components │ 01KSAV…JK  │
└─────────────┴──────────────────┴────────────┘
```

**3. Diff** — three-column compact table, glyph column colored per kind, summary footer.

```
DIFF  nextjs-fullstack ↔ python-fastapi

  ~ metadata   description                  modified
  ~ resource   instruction/project-context  modified
  − resource   rule/react-components        removed
  + resource   rule/api-design              added

7 changes · 1 added · 3 removed · 3 modified
```

**4. Verdict** — single line with icon, optional `→` hint on the next line.

```
✓ Preset "nextjs-fullstack" is valid.
```

```
⚠ Drift detected (3 changes) since snapshot 01KSAV…
  → Run `harnessdeck project diff` for details
```

**5. Progress** — spinner that mutates in place, then resolves to a verdict.

```
⠋ Scanning /Users/me/repo…
✓ claude-code · imported 12 resources
✓ codex · imported 3 resources
```

**6. Error with hint** — danger verdict + indented `→` next-step.

```
✗ Preset not found: doesnotexist
  → Run `harnessdeck preset list` to see available presets.
```

### Non-TTY / NO_COLOR Fallback

- chalk auto-disables color when `NO_COLOR` is set or `chalk.level === 0`.
- Box-drawing characters degrade to ASCII (`|`, `-`, `+`) via `cli-table3`'s `chars` config when `process.stdout.isTTY === false` or `NO_COLOR` is set.
- Icons are plain Unicode and stay regardless.
- `ora` spinners no-op automatically in non-TTY.
- A new global `--no-color` flag is parsed at startup and sets `chalk.level = 0` plus `process.env.NO_COLOR = "1"`.

## Module Layout

The redesign lives in a new peer module `src/ui/`. Nothing inside the module imports from outside the module except `chalk`, `cli-table3`, and `ora`.

```
src/ui/
├── index.ts        public surface, re-exports below as `ui.*`
├── theme.ts        palette, icons, color/TTY detection
├── format.ts       pure helpers: truncate, padCell, shortenId,
│                   formatRelativeTime, formatCount, summarizeTypes
│                   (shortenId = first 6 + "…" + last 4;
│                    formatRelativeTime = "N seconds/minutes/hours/days ago"
│                    for ≤ 30 days, ISO date otherwise)
├── status.ts       success(), warn(), danger(), info(), dim(), hint()
├── section.ts      header(title), subheader(title), rule()
├── kv.ts           kv(label, value), kvBlock(rows[])
├── panel.ts        panel({ title, rows, footer? })
├── table.ts        table({ columns, rows, summary?, empty? })
├── diff.ts         diffTable(changes[])
└── progress.ts     spinner(label) → { step, succeed, fail, stop }
```

### Public surface

Call sites import a single namespace `ui` and compose primitives:

```ts
import { ui } from "@/ui";

ui.header("PRESET", "nextjs-fullstack");
ui.kvBlock([
  ["Description", preset.description],
  ["Tags",        preset.tags.join(", ")],
  ["ID",          ui.format.shortenId(preset.id)],
  ["Updated",     ui.format.formatRelativeTime(preset.updated_at)],
]);

ui.subheader("RESOURCES");
ui.table({
  columns: [
    { key: "type", header: "TYPE",  width: 14 },
    { key: "name", header: "NAME" },
    { key: "id",   header: "ID",    transform: ui.format.shortenId },
  ],
  rows: resources,
  empty: "No resources in this preset.",
});

ui.success(`Preset "${name}" is valid.`);
ui.danger(`Preset not found: ${name}`, {
  hint: "Run `harnessdeck preset list` to see available presets.",
});

const spinner = ui.spinner("Scanning…");
spinner.step("claude-code");
spinner.succeed("imported 12 resources");
```

### Table column type

```ts
type Column<Row> = {
  key: keyof Row & string;
  header: string;
  width?: number;            // fixed cell width; truncate-with-ellipsis on overflow
  align?: "left" | "right";  // default "left"
  transform?: (value: Row[keyof Row], row: Row) => string;
  style?: (value: string, row: Row) => string;
};
```

The table renderer auto-sizes any column without `width` to fit the widest cell or the terminal width, whichever is smaller, and truncates with `…`. `table.ts` is the single file that knows about `cli-table3`.

### Theme

```ts
const colorOn = chalk.level > 0 && !process.env.NO_COLOR;

export const theme = {
  primary: (s: string) => chalk.bold(s),
  accent:  (s: string) => chalk.hex("#3b82f6")(s),
  muted:   (s: string) => chalk.hex("#6b7280")(s),
  success: (s: string) => chalk.hex("#10b981")(s),
  warn:    (s: string) => chalk.hex("#f59e0b")(s),
  danger:  (s: string) => chalk.hex("#ef4444")(s),
  badge:   (s: string) => chalk.bgHex("#1d4ed8").white.bold(` ${s} `),
  icon: {
    success: "✓",  warn: "⚠",  danger: "✗",  hint: "→",
    bullet: "·",   added: "+", removed: "−", modified: "~",
  },
};

export const tty = {
  isTty: () => process.stdout.isTTY === true,
  cols: () => process.stdout.columns ?? 80,
};
```

### Dependencies added

- `cli-table3` — ~30kB, no transitive deps, used by npm. Added to `dependencies`.
- `ora` — ~50kB. Added to `dependencies`.

### Fate of `src/utils/logger.ts`

- During migration: becomes a one-line re-export shim of `ui.status.*` so any not-yet-migrated call site keeps compiling.
- After Phase C: deleted; the import is removed everywhere.

## Per-Command Output Specification

JSON output is unchanged for every command listed below.

### Listing commands → table + summary footer

| Command | Columns | Notes |
|---|---|---|
| `preset list` (`ls`) | `NAME · DESCRIPTION` | Footer: `N presets · run \`harnessdeck preset show <name>\` for details`. Empty: `No presets found.` |
| `resource list` (`ls`) | `TYPE · NAME · ID · UPDATED` | ID rendered via `shortenId`; `UPDATED` via `formatRelativeTime`. Empty hint: `→ Run \`harnessdeck project scan\` to import some.` |
| `platform list` (`ls`) | `ID · NAME · CAPABILITIES` | Capabilities is a comma-joined list, truncated to fit. |
| `plugin installed` | `PLATFORM · REF · VERSION · SCOPE` | `PLATFORM` styled muted for visual grouping. |
| `plugin check` | `STATUS · PLATFORM · REF · VERSION · LATEST · SCOPE` | `STATUS` colored per row: `current` (success), `outdated` (warn), `unknown` (muted). Footer: `N plugins · X current · Y outdated · Z unknown`. Exit code unchanged. |
| `project history` | `WHEN · ID · LABEL` | `WHEN` relative time; `ID` shortened. |

### Detail commands → panel + optional sub-table(s)

| Command | Panel rows | Sub-tables |
|---|---|---|
| `preset show <name>` | Description, Tags, ID, Resources (count + summary), Plugins (count), Updated | `RESOURCES` table; `PLUGINS` table or `(none pinned)` |
| `resource show <id\|name>` | Type, Name, Description, Source, Created, Updated | `METADATA` block (compact JSON, muted), then `--- Content ---` section |
| `plugin show <ref>` | ref, version, enabled, scope, install path | `SCOPES` sub-table when more than one scope declares the ref |
| `plugin list` | (scanned-at row) | `COMMITTED` and `EFFECTIVE` sub-tables (current behavior preserved) |
| `project status [path]` | Root, Git origin, Platforms, Applied presets, Snapshots, Plugins | Plugins row colored `warn` when outdated > 0, `success` when outdated = 0, `muted` when count = 0 |
| `harness status` | Main harness, Aliases | — |
| `harness project status` | Main harness, Aliases, Materialization | — |

Ambiguous resource selectors render the danger verdict plus an inline `TYPE · NAME · ID` sub-table of matches.

### Diff / drift / validate → verdict + diff-table

- `preset diff <left> <right>` — diff-table as shown above. No differences → `success("No differences.")` only.
- `project drift` — diff-table; verdict either `success("No drift detected since last snapshot.")` or `warn("Drift detected (N changes) since snapshot 01KSAV…")`. Exit code unchanged.
- `preset validate <name>` — `success` when clean, otherwise a `SEVERITY · CODE · MESSAGE` table (severity colored danger/warn) with footer `N errors · M warnings`. Exit code unchanged.

### Write-progress commands → spinner + verdicts

- `project scan [path]` — spinner while scanning; success verdicts per platform with indented `·` resource breakdown; project-registered verdict; plugin-summary hint. Dry-run prefixes the verdict line with muted `[dry run]` and skips the project-registered line.
- `project apply <preset…>` — one spinner per platform, resolving to `✓ claude-code · wrote N files` with file paths as `·` rows. Plugin-pin issues render as `warn(...)` lines under the per-platform verdict. `--strict-plugin-versions` failure → `danger("Plugin pin violations — apply aborted")` and exit 2.
- `project sync [path]`, `plugin update`, `plugin refresh`, `plugin check --refresh` — same pattern: spinner during work, single success/warn verdict, indented `·` rows for details.

### Mutate / single-line verdict commands

`preset create | delete | add | remove | add-plugin | remove-plugin | export | import | from-project`, `resource delete`, `harness set`, `harness project set`, `migrate export | import`, `project revert` — each prints exactly one verdict line:

```
✓ Created preset nextjs-fullstack · 4 resources
✓ Added rule "react-components" to preset nextjs-fullstack
✓ Pinned formatter@team-plugins (^2.1.0) on preset team-stack
✓ Exported preset team-stack → ./team-stack.harnessdeck.json
✓ Restored 7 files from snapshot 01KSAV…W3 (2 days ago)
```

Names and refs use `accent`; counts and paths use default; preset/snapshot identifiers use `muted`. Errors flip to `danger` plus an indented `→` hint.

### `init` — narrative remapped to the theme

Today's hex colors are remapped onto theme roles. `platformBadge` becomes `theme.badge`, folder accent becomes `theme.success`, status accent maps to `theme.warn` (imported) or `theme.success` (already tracked). The section header `Home defaults overview` becomes `HOME DEFAULTS`.

```
✓ Harnessdeck initialized

  Database          /Users/me/.harnessdeck/harnessdeck.db
  Built-in Presets  seeded 2 built-in presets

HOME DEFAULTS

   Claude Code   ~/.claude
    Contains    CLAUDE.md, agents/, skills/
    Found       12 resources (1 instruction, 4 skills, 7 rules)
    Status      12 new resources imported

   Codex   ~/.codex
    Contains    AGENTS.md
    Found       1 resource (1 instruction)
    Status      already tracked

MAIN HARNESS   claude-code
ALIASES        cursor, codex
```

The exact phrase `Harnessdeck initialized` is preserved so existing `toContain` assertions keep passing.

### Help — override commander's formatter

The top-level program overrides `helpInformation()` to use the theme:

- `USAGE` and `COMMANDS` rendered as uppercase muted section headers.
- Commands grouped by parent noun (`preset`, `project`, `harness`, `plugin`, `resource`, `migrate`, `platform`), each as a sub-section with its own indented list.
- Subcommand descriptions wrapped at terminal width with hanging indent.
- Hidden compatibility aliases (`scan`, `apply`, `export`, `import`, `history`, `revert`, `status`, `platforms`) excluded from default help; available via `harnessdeck --help --all`.

```
harnessdeck — preset-based AI coding assistant configuration manager

USAGE
  harnessdeck <command> [options]

COMMANDS
  init                          Initialize the database and config

  preset                        Manage presets
    list, show, create, delete, add, remove, add-plugin, remove-plugin,
    diff, validate, export, import, from-project

  project                       Scan, apply, snapshot, sync
    scan, apply, drift, sync, history, revert, status

  harness                       Main + alias harness preferences
    set, status, project set, project status

  plugin                        Inventory and lifecycle
    list, show, installed, check, update, refresh

  resource                      Imported configuration resources
    list, show, delete

  migrate                       Move state between machines
    export, import

  platform                      Inspect supported platforms

GLOBAL OPTIONS
  -V, --harnessdeck-version     Print the CLI version
  -h, --help                    Show help for a command
      --no-color                Disable color output (also: NO_COLOR=1)
      --format <mode>           human (default) or json — per command
```

## Testing Strategy

### Renderer unit tests

A new `test/ui/` directory mirrors `src/ui/`. One test file per primitive (`table.test.ts`, `panel.test.ts`, `diff.test.ts`, `status.test.ts`, `format.test.ts`).

Each test runs twice — once with `FORCE_COLOR=0`, once with `FORCE_COLOR=1` — and asserts on the produced string. Snapshots are acceptable: the visible output is the contract.

Assertions target structural properties (column count, summary footer text, presence of glyphs, presence/absence of cell contents) rather than raw escape sequences. Color coverage is implicit via the `FORCE_COLOR=1` snapshot.

### Command-level tests

Existing JSON-mode tests stay as-is — they remain the behavioral contract. Human-mode regression coverage is added for representative commands only:

- `preset list` (table)
- `preset show` (panel + sub-table)
- `preset diff` (diff-table)
- `project status` (panel with colored row)
- `init` (narrative, badge, status accents)
- `project apply` (verdicts after spinner; spinner frames themselves are suppressed in tests)

The spinner is a no-op when `tty.isTty()` is false. That covers piped output, redirected output, `CI=1` runners (whose stdout is rarely a TTY), and the test harness — so `runCli` tests do not see spinner frames in stdout. JSON-mode invocations also suppress the spinner.

### Existing tests that change

| Test | Line | Change |
|---|---|---|
| `test/cli/init.test.ts` | 49 | `"Home defaults overview"` → `"HOME DEFAULTS"` |
| `test/cli/apply.test.ts` | 100 | `"claude-code: wrote 1 file(s)"` → `"claude-code · wrote 1 file"` |

All other existing `toContain` assertions in `test/cli/*.test.ts` survive: preset names, resource IDs, file paths, and the `"Plugin version mismatch:"` warning string are all preserved in the new design.

## Migration Plan

Incremental, by command family. Each phase is a separate commit / PR. `bun run preflight` stays green between phases.

| Phase | What lands | Tests touched |
|---|---|---|
| **A** | `src/ui/` module + tests; `cli-table3` and `ora` dependencies; `src/utils/logger.ts` becomes a re-export shim of `ui.status.*`; no call-site changes. | New `test/ui/*.test.ts`. Existing tests untouched. |
| **B1** | All `list` / `ls` commands → `ui.table`: `preset list`, `resource list`, `platform list`, `plugin installed`, `plugin check`, `project history`. | None of the existing list-output assertions change. |
| **B2** | All detail commands → `ui.panel`: `preset show`, `resource show`, `plugin show`, `plugin list`, `project status`, `harness status`, `harness project status`. | `preset.test.ts:36-38` still pass. |
| **B3** | Diff / validate / drift → `ui.diffTable` + verdict pattern. | None. |
| **B4** | `init` narrative remapped to the theme; `"Home defaults overview"` → `"HOME DEFAULTS"`. | `init.test.ts:49` updated. |
| **B5** | Mutate-and-verdict commands (`create`, `delete`, `add`, `remove`, `export`, `import`, `from-project`, `migrate`, `revert`, `harness set`). | None. |
| **B6** | Spinner-driven commands: `project scan`, `project apply`, `project sync`, `plugin update`, `plugin refresh`, `plugin check --refresh`. | `apply.test.ts:100` updated. |
| **B7** | Help formatter override + `--no-color` global flag + `--help --all` for hidden aliases. | None. |
| **C** | Remove `src/utils/logger.ts`; remove its import from `src/index.ts`; ensure `chalk` imports remain only inside `src/ui/`. | None. |

## Documentation Changes

- `README.md` — refresh the sample outputs in `Demo` and the inline command snippets to match the new visual style.
- `docs/scenarios/vhs/tapes/01-existing-repo-adoption.tape` — re-record the GIF after Phase B6 lands, so the README walkthrough matches what users see when they run the CLI.
- No change to the public command contract, flags, or JSON schemas.
