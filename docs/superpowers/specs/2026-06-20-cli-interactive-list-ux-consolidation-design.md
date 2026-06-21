# CLI Interactive List UX Consolidation

**Date:** 2026-06-20  
**Status:** Implemented  
**Scope:** Refactor harnessDeck’s `@inquirer/core` interactive list prompts into a shared system with consistent keyboard UX, less duplication, and modest performance wins.

## Problem

HarnessDeck ships six bespoke interactive list prompts under `src/services/wizards/`, each re-implementing the same keyboard/search/render patterns:

| Module | Data source | Selection | Submit | Esc (browse) | Detail view |
| --- | --- | --- | --- | --- | --- |
| `searchable-multi-select.ts` | Static choices | Multi checkbox | Enter | `PromptBackError` (wizard back) | — |
| `interactive-resource-list.ts` | Local resources | Single highlight | Esc commits filter | Returns `{ query }` | Enter → show, Esc → browse |
| `interactive-catalog-browser.ts` | Remote catalog | Single highlight | Enter installs | `ExitPromptError` | — |
| `interactive-catalog-search.ts` | Remote catalog | Multi checkbox | Ctrl+S apply | `ExitPromptError` | Enter → show, Esc → browse |
| `interactive-layer-edit.ts` | Local composition rows | Multi checkbox | Ctrl+S save | `ExitPromptError` | Enter → show, Esc → browse |
| `interactive-environment-edit.ts` | Local env rows | Single highlight | Letter keys | `{ type: "cancel" }` | — |

Roughly **250+ lines** of duplicated helpers (`isEscapeKey`, `isSearchCharacter`, `clampActiveIndex`, `keysHelpTip` theme) and **~160 lines** of near-identical remote-search/debounce logic between catalog browser and catalog search.

### UX inconsistencies

1. **Escape semantics differ by prompt** even when help text uses similar labels (“exit” vs “cancel” vs “back”):
   - `resource list`: Esc **commits** the current search and exits successfully.
   - Catalog browse/search & layer edit: Esc **cancels** with `ExitPromptError` → exit code 1.
   - Multi-select wizards: Esc **goes back** via `PromptBackError`.
   - Environment edit: Esc returns `{ type: "cancel" }` (soft cancel inside a loop).

2. **Submit keybindings differ** for multi-select flows:
   - `searchable-multi-select`: Enter submits checked items.
   - `interactive-catalog-search` / `interactive-layer-edit`: Enter opens detail view; Ctrl+S submits.

3. **`isSearchCharacter` has two variants** — some prompts reject shift-modified keys, others do not. Uppercase search is inconsistent.

4. **Help line ordering and grouping** vary; ctrl+a/ctrl+x hints appear in different positions.

5. **Cancellation detection is fragmented** — callers check `isPromptCancellationError` (ExitPromptError) but not `PromptBackError` or soft-cancel results; resource list never throws on Esc so it cannot be “cancelled” mid-flow.

### Performance issues

1. **`interactive-catalog-browser.ts` stores refs in `useState`** (`fetchedQueryRef`, `debounceRef`, `requestRef`) and gates initial fetch inside the render body (`if (fetchedQueryRef.current === "__unset__")`). `interactive-catalog-search.ts` correctly uses `useRef` + `useEffect`. The browser variant risks extra renders and was harder to test (no dedicated unit tests).

2. **Full table re-render on every keystroke** for local lists (`resource-list`, `layer-edit`, `environment-edit`). Acceptable today for typical DB sizes, but the pattern does not scale and duplicates work when only the highlight or filter set changes.

3. **Duplicated debounced remote search** — two copies of 300 ms debounce, request-id stale-guard, and loading/error state.

## Goals

1. **One keyboard contract** documented and enforced across list prompts.
2. **Shared primitives** for key detection, local filter state, remote debounced search, browse/show sub-views, and help lines.
3. **Preserve existing user-visible behavior** unless explicitly standardized (see Migration).
4. **Reduce file-level duplication** without over-abstracting — prompts stay readable.
5. **Fix catalog-browser ref/render anti-pattern** and share remote-search hook.
6. **Keep test coverage** — existing `@inquirer/testing` suites remain green; add shared primitive tests.

## Non-goals

- Replacing `@inquirer/core` or migrating wizard `inquirer` prompts (`promptForChoice`, etc.).
- Building a general TUI framework usable outside HarnessDeck.
- Pagination/virtualization for local resource tables (defer unless profiling shows need).
- Changing non-interactive CLI output or JSON contracts.

## Proposed architecture

### Layer 1: Prompt primitives (`src/services/wizards/prompts/primitives.ts`)

Shared, pure utilities:

```ts
// Key helpers (single implementation)
isEscapeKey(key)
isSearchCharacter(key, opts?: { allowShift?: boolean })
clampActiveIndex(active, length)

// Theme fragment reused by all interactive prompts
interactivePromptTheme  // keysHelpTip, helpMode

// Help builder
buildHelpLine(actions: Array<[key: string, label: string]>): string
```

### Layer 2: Composable hooks (`src/services/wizards/prompts/hooks/`)

| Hook | Responsibility |
| --- | --- |
| `useLocalQueryFilter` | `query`, `setQuery`, `onBackspace`, `onType`, reset active index |
| `useListNavigation` | `active`, `clampedActive`, up/down handlers |
| `useBrowseShowView<T>` | `view`, `showingItem`, enter-to-show, esc-to-browse |
| `useDebouncedRemoteSearch<T>` | debounce, stale-request guard, loading/error, `scheduleSearch` |
| `useCheckboxSelection<TKey, TItem>` | toggle, select-visible, clear-visible, checked map |

These hooks use `@inquirer/core`’s `useState`, `useRef`, `useEffect` — not React.

### Layer 3: Prompt composers (`src/services/wizards/prompts/`)

Thin `createPrompt` wrappers that wire hooks + domain renderers:

| Composer | Replaces | Notes |
| --- | --- | --- |
| `createFilterListPrompt` | `interactive-resource-list` | Local data, esc commits |
| `createRemoteSelectPrompt` | `interactive-catalog-browser` | mode: single, enter submits |
| `createRemoteMultiSelectPrompt` | `interactive-catalog-search` | checkboxes, ctrl+s, browse/show |
| `createLocalMultiSelectPrompt` | `searchable-multi-select` | static choices, enter submit, esc → PromptBackError |
| `createEditableMultiSelectPrompt` | `interactive-layer-edit` | extends multi-select + constraint sub-view |
| `createActionListPrompt` | `interactive-environment-edit` | letter shortcuts, soft cancel |

Existing public exports (`promptForInteractiveResourceList`, etc.) become thin re-exports from composers for a non-breaking migration.

### Layer 4: Domain renderers (unchanged ownership)

Keep rendering in `src/ui/`:

- `resource-list-render.ts` — resource & layer-edit tables
- `catalog-list-render.ts` — catalog browse/search tables & show panels

Composers pass `renderBody(state) => string` callbacks; no UI logic moves into hooks.

## Keyboard contract (target)

Document in `docs/cli/interactive-lists.md` and enforce via shared help lines + tests.

### Universal

| Key | Behavior |
| --- | --- |
| ↑ / ↓ | Move active item (clamp at bounds; no wrap unless `loop: true`) |
| Typeable chars | Append to search query (including uppercase); reset active to 0 |
| Backspace | Delete last query char; reset active to 0 |
| Esc in **detail** view | Return to browse (never exit prompt) |

### By prompt **mode**

| Mode | Enter | Esc (browse) | Multi-select extras |
| --- | --- | --- | --- |
| `filter` | Open detail (if item) | **Commit** query and exit | — |
| `select-one` | Confirm selection and exit | **Cancel** (`ExitPromptError`) | — |
| `select-many` (wizard) | Submit checked items | **Back** (`PromptBackError`) | Space toggle; Ctrl+A all visible; Ctrl+X none visible |
| `select-many` (action) | Open detail | **Cancel** (`ExitPromptError`) | Space toggle; Ctrl+A/X; **Ctrl+S submit** |
| `action-menu` | Edit active row | **Cancel** (soft result) | `a` add, `d` delete, `q` quit save |

### Standardized labels

| Internal action | Help label |
| --- | --- |
| Commit filter | `esc exit` |
| Cancel prompt | `esc cancel` |
| Wizard back | `esc back` |
| Detail back | `esc back` |

## Escape / cancellation unification

Introduce a single result type for prompt outcomes:

```ts
type PromptOutcome<T> =
  | { kind: "success"; value: T }
  | { kind: "cancel" }          // ExitPromptError — exit code 1
  | { kind: "back" }            // PromptBackError — wizard step back
```

Composer wrappers translate:

- `ExitPromptError` → `{ kind: "cancel" }` at call sites that already use `isPromptCancellationError`
- `PromptBackError` → `{ kind: "back" }` for wizard loops using `withPromptBack`

**No change** to resource-list Esc = commit behavior (mode `filter`). Only align help text to say `exit` not `cancel`.

## Catalog browser + search consolidation

Both prompts share:

- Remote `listLayers({ q, limit })` injection
- Debounced search hook
- Scope label header
- Catalog table rendering

Merge into **`createRemoteCatalogListPrompt`** with config:

```ts
type RemoteCatalogListMode =
  | { kind: "install" }   // single select, enter → result
  | { kind: "apply" };    // multi select, ctrl+s → selections, enter → show
```

`runInteractiveCatalogBrowser` and `runInteractiveCatalogSearch` remain as named entry points delegating to the composer with the appropriate mode. This directly supports the related [layer-list catalog consolidation](2026-06-19-layer-list-catalog-consolidation-design.md) work without coupling to `layer-list.ts` command routing.

## Performance plan

| Change | Impact | Effort |
| --- | --- | --- |
| Fix catalog-browser `useRef` + `useEffect` init | Removes spurious renders; aligns with search prompt | Low |
| Shared `useDebouncedRemoteSearch` | One implementation to optimize/test | Low |
| Memoize `filterResourcesBySearch` result key in composers | Skip table rebuild when query unchanged | Low |
| Defer grouped table render until query settles (optional 50 ms debounce for local filter) | Helps large resource DBs | Medium — only if profiling warrants |

No virtualization in v1.

## Migration strategy

**Phase 1 — Primitives (no behavior change)**

1. Add `prompts/primitives.ts` + tests.
2. Replace duplicated helpers in all six files with imports.
3. Fix catalog-browser ref pattern using shared `useDebouncedRemoteSearch`.

**Phase 2 — Hooks + catalog merge**

1. Extract hooks; migrate catalog browser & search to shared composer.
2. Add `interactive-catalog-browser.test.ts` mirroring search tests.

**Phase 3 — Local list composers**

1. Migrate `interactive-resource-list`, `searchable-multi-select`.
2. Migrate `interactive-layer-edit`, `interactive-environment-edit`.

**Phase 4 — Docs & contract tests**

1. Add `docs/cli/interactive-lists.md`.
2. Add `test/services/interactive-list-contract.test.ts` asserting help lines match mode contract.

Each phase is independently shippable; phases 1–2 deliver the highest ROI.

## Approaches considered

### A. Shared primitives only (minimal)

Extract helpers + remote search hook; leave six separate `createPrompt` files.

- **Pros:** Lowest risk, fast.
- **Cons:** Keypress handlers stay duplicated; UX drift likely returns.

### B. Full composer framework (recommended)

Primitives + hooks + mode-based composers; thin domain wrappers.

- **Pros:** Enforces contract; catalog merge natural; best duplication reduction.
- **Cons:** Moderate upfront design; requires careful typing for render callbacks.

### C. Adopt `@inquirer/search` / `@inquirer/checkbox` everywhere

Replace custom prompts with stock Inquirer prompts.

- **Pros:** Less custom code.
- **Cons:** Cannot support browse/show detail views, grouped tables, ctrl+s submit, or remote debounced search without forking; rejected.

**Recommendation:** Approach **B**, delivered incrementally via Phase 1–4.

## Testing

| Area | Tests |
| --- | --- |
| Primitives | Unit tests for key helpers, clamp, search char w/ shift |
| `useDebouncedRemoteSearch` | Stale request ignored; debounce; error path |
| Catalog composer | Port existing `interactive-catalog-search.test.ts`; add browser tests |
| Contract | Snapshot help lines per mode; Esc path per mode |
| CLI integration | Existing `resource.test.ts`, `layer.test.ts`, `wizard-prompts.test.ts` stay green |

## Risks

| Risk | Mitigation |
| --- | --- |
| Behavior regression on Esc/Enter | Contract tests; phase-by-phase migration |
| Over-abstraction | Composers stay <150 lines; domain render stays in `ui/` |
| Wizard back vs cancel confusion | Explicit `PromptOutcome` at boundaries; document in interactive-lists.md |

## Resolved decisions

Industry reference points: **fzf** / **skim** (picker semantics), **Inquirer checkbox** (multi-select), **VS Code / lazygit** (drill-down vs commit), **incremental search in less/vim** (filter overlays).

### 1. Resource list: Esc commits the filter (including empty query)

**Decision:** Keep current behavior. Esc in `filter` mode always exits with the current query; empty query means “no filter” and shows the full list.

**Rationale:** `resource list` interactive mode is a **live filter overlay**, not a picker. Users type to narrow, then leave. That matches incremental-search overlays (e.g. `less` `/pattern`, file-tree filters) where exiting applies whatever is typed. Empty query → unfiltered results is the expected default (same as omitting `--search`).

**Not adopting (for now):** Two-stage Esc (first Esc clears query, second Esc exits) — used by VS Code find when focus is in the input. Our prompt *is* the input; a single Esc to “done filtering” is simpler and matches `resource list`’s “filter then list” mental model.

**Spec detail:** Help label stays `esc exit` (not `cancel`). Callers must not treat a successful `{ query: "" }` as cancellation.

### 2. Submit key: Enter for simple multi-select; Ctrl+S when Enter opens detail

**Decision:** Do **not** unify on Enter everywhere. Keep the split:

| Prompt kind | Submit | Enter in browse |
| --- | --- | --- |
| `searchable-multi-select` (no detail view) | **Enter** | N/A (toggle is Space) |
| `interactive-catalog-search`, `interactive-layer-edit` (detail view) | **Ctrl+S** | Opens detail |

**Rationale:** **Principle of least surprise for overloaded keys** — when Enter already means “open / inspect” (lazygit, k9s, `gh` browse flows), reusing it for “commit side effects” causes mis-clicks. Ctrl+S as “save / apply” is a widely learned affordance from editors and maps well to **mutating** actions (apply layers, save composition). Wizard multi-selects without a detail step should follow **Inquirer checkbox** convention: Space toggles, Enter confirms — no conflict.

**Future option (out of scope):** `Shift+Enter` or `i` for inspect, Enter to submit — closer to fzf multi (`Tab` select, `Enter` confirm) but requires UX change and retraining; not worth it in v1.

### 3. Shift-key search: allow uppercase everywhere

**Decision:** `isSearchCharacter` accepts shift-modified printable keys in **all** prompts (`allowShift: true` as the only implementation).

**Rationale:** Incremental search tools (fzf, skim, peco) accept whatever the user types; filtering is case-insensitive in our matchers, but users still type uppercase for acronyms, camelCase, or habit. Blocking shift is non-standard and reads as a bug. One shared helper avoids the current split (some prompts block shift, some don’t).

**Implementation:** Normalize to the typed character in the query string; keep existing `.toLowerCase()` in filter functions unless we add an explicit case-sensitive mode later.

## Success criteria

- [ ] Zero duplicated `isEscapeKey` / `isSearchCharacter` / `clampActiveIndex` outside `primitives.ts`
- [ ] Catalog browser and search share one remote-search implementation
- [ ] Catalog browser uses `useRef` (no render-body side effects)
- [ ] All existing interactive prompt tests pass
- [ ] `docs/cli/interactive-lists.md` documents the keyboard contract
- [ ] Help text labels match actual Esc behavior per mode

## Related work

- Empty placeholder: `docs/superpowers/specs/2026-06-19-layer-list-catalog-consolidation-design.md` — command routing for `layer list` / `profile list`; this spec covers the **prompt layer** that those commands depend on.
- `SPEC.md` CLI UX contract — interactive behavior is an extension; update cross-link after implementation.
