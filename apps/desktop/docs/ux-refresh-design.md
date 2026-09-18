# HarnessTap Desktop UX refresh: design doc

Status: proposal. Scope: `apps/desktop` only. Nothing in this document is implemented yet.

Goal (from the brief): make the Desktop app beautiful, make motion flawless, make the UX responsive (instant feedback, no jank, no blocking), and make the app easy and intuitive.

This document is written so that each work package (WP) can be handed to an agent as a self-contained task. Every WP lists the files it touches, what "done" means, and how to verify it. WPs are ordered so that foundations land before features; a dependency graph is at the end.

Related: [`DESIGN.md`](../DESIGN.md) is the UI lockfile and stays authoritative. Where this doc proposes a change to a lock, it is called out explicitly under "DESIGN.md amendments" and must land in `DESIGN.md` in the same PR as the code.

---

## 1. How the review was done

- Full read of `apps/desktop/src` (~43k lines: `App.tsx` 3455, `styles.css` 5218, `LiveStatePanel.tsx` 2462, `PluginPackageDetail.tsx` 1727, `SourcesWorkspace.tsx` 1356, `ResourceDetailBody.tsx` 1282).
- Live run of the UI against the real `ht-agent` sidecar (`bun src/agent/entry.ts` with an isolated `HOME`, Vite dev server, Chromium via Playwright with the Tauri IPC shimmed) using the `claude-plugins-home`, `cursor-project`, and `claude-project` fixtures. Screenshots were taken of every workspace, every overlay, and the header at 1440, 1100, 900, 760 and 640px.
- Contrast, token, and motion inventories were computed over `styles.css`.

Note for implementers: **web-only dev mode (`bun run dev` + `VITE_AGENT_URL`) does not currently connect.** `waitForHealth` in `src/lib/agent-client.ts` calls `invoke("get_sidecar_port")` inside the retry loop; in a plain browser `invoke` throws, the `fetch` is never reached, and the UI sits on "Waiting for sidecar health check" forever. WP0 fixes this because every later WP needs fast visual iteration and screenshot-based verification.

---

## 2. Executive summary of findings

The app has a coherent intent (dense dark ops chrome, one accent, icon chrome with tooltips) and a very detailed lockfile, but the implementation under-delivers on all four goals:

| Goal | State today | Root cause |
| --- | --- | --- |
| Beautiful | Palette is fine; type, spacing, elevation and states are ad hoc. 21 distinct font sizes, 83 declarations under 13px, zero `:active` rules, one drop shadow, default light OS scrollbars on dark panes, fonts loaded from Google Fonts at runtime (falls back to Segoe UI offline). | No token tiers beyond palette; 5218-line CSS monolith with 25 to 35% near-duplicate rules; no bundled fonts. |
| Flawless animation | There is effectively **no motion**: one spinner keyframe, one `transition` (inside the reduced-motion reset), `tw-animate-css` used only by shadcn `Select`/`Popover`. Every overlay, pane swap, row add/remove, and the apply progress panel hard-mounts. Even the two motions DESIGN.md allows (status color transitions, switch-step highlight) are not implemented. | DESIGN.md motion lock is narrow, and nothing was built even inside that lock. No motion tokens. |
| Responsive UX | 2s status poll re-renders the whole `App` tree (79 `useState` and 46 `useCallback` hooks in one component). Apply preview is wiped to `null` then "Loading" on every profile/scope change. Library list is replaced by "Loading resources…" on every reload. Environments detail shows the previous environment until the next fetch lands. No optimistic updates anywhere; `switching` unmounts the inventory and disables the whole chrome. No list virtualization; no search debounce. | Monolithic state in `App.tsx`; wait-then-refetch everywhere; no cache/last-good-value discipline. |
| Easy and intuitive | Re-clicking the selected profile **deselects** it. Selected vs active vs applied is only a rail highlight and a tiny badge. Three ways to add resources (rail ListPlus, inventory Add/Add all, FAB). Discover verbs (Pull / Pin / Attach / Open in Library) are tooltip-only and not self-explanatory. Double-click-to-edit fields have no affordance. Settings shows two Save buttons on the Project tab. "You're caught up" is shown for a search with no matches. First-run Tracked directories modal reopens on every Library visit in the session. Header breaks below ~1000px while Tauri `minWidth` is 360. | Many small locks were added incrementally without a pass for coherence; no empty-state/first-run design; no responsive design below 1100px. |

The plan below fixes these in five layers: **foundation** (tokens, fonts, CSS split, motion system, state store), **shell** (navigation, overlays, feedback, responsiveness), **workspaces** (scope, Library, Discover, Environments, Settings), **polish** (micro-interactions, empty states, keyboard), and **verification** (visual regression, motion audit).

---

## 3. Evidence: concrete defects observed

Grouped by surface. File references are to `apps/desktop/src`. Severity: H (blocks a goal), M (visible friction), L (polish).

### 3.1 Shell, navigation, feedback

| Sev | Finding | Where |
| --- | --- | --- |
| H | Whole `App` re-renders on every 2s poll; `LiveStatePanel` gets a ~50-prop bag spanning 110 lines. | `App.tsx:184-330` (79 `useState`), `App.tsx:1300-1310` (poll), `App.tsx:3129-3241` (~50 props) |
| H | Apply preview cleared then reloaded on each selection/scope change: pane flashes empty. | `App.tsx:843-846` |
| H | No skeletons; disconnected state paints the full shell with disabled controls plus a red banner. | `App.tsx:2427-2439` |
| H | Failed switch step uses the same `cur` (yellow, in-progress) class as the current step. | `App.tsx:3100-3112`, `styles.css:3644` |
| H | Overlays have no focus trap, no initial focus, no focus restore; 11 independent `window` `keydown` Esc listeners, no layer stack (two open layers both close on one Esc). | `FullScreenPanel.tsx:32-42`, `lib/dialog-dismiss.ts`, `ProjectPicker.tsx:65`, plus 8 others |
| H | Header does not degrade: at 900px the brand clips into Library, the project picker collapses to a bare `▾`, Install/History overlap Refresh; at 760px controls overlap. Tauri `minWidth` is 360. | `styles.css:119-360`, `src-tauri/tauri.conf.json:18-21` |
| M | Success feedback is a 3s header text flash (`setSuccessMessage` + `setTimeout` copy-pasted ~15 times); no queue, no toast. Import/Export succeed silently. | `App.tsx:2320`, `App.tsx:3346-3366`, `styles.css:5022` |
| M | Four different error banner behaviors (retry only, dismiss only, both, stuffed in an empty state). | `App.tsx:3245-3266`, `App.tsx:2594` |
| M | No `aria-current` on destinations; scope is modeled as a history peer of destinations, contrary to DESIGN.md. | `lib/header-destination.ts`, `App.tsx:1968-2034` |
| M | Internal names `sources`/`home` vs UI "Discover"/"Global"; Environments wired through `parity/ParityChrome.tsx`. | `App.tsx`, `components/parity/ParityChrome.tsx` |
| M | `hasFullHarnessSnapshot` reset on every reconnect/project change: harness rows flicker back to "checking". | `App.tsx:822` |
| M | SSE `onerror` fails the apply immediately; no retry. No AbortController or generation counter on poll/preview fetches (out-of-order responses can win). | `lib/agent-client.ts:1108-1125` |
| M | Update check failure hides the Update control (no badge can mean "check failed"). | `UpdateAvailableControl.tsx:45-56` |
| L | `title=` used on header destinations, `FullScreenPanel` back, `ParityChrome`, `ResourceTypeModal` close, Settings harness info instead of `ChromeTooltip` + `aria-label`. | various |

### 3.2 Global / Project scope

| Sev | Finding | Where |
| --- | --- | --- |
| H | Clicking the already-selected profile clears the selection (main pane goes to "No profile selected"). | `App.tsx:2705-2707` |
| H | Selected vs active vs applied is under-signaled; Apply is silently disabled when `selected === active && applied`. | `App.tsx:2177-2187`, `lib/reapply.ts:15-29` |
| H | `switching` replaces the inventory with the yellow step list and disables everything. | `App.tsx:3094-3127` |
| H | No optimistic updates for Add / Activate / Remove; Add all and Activate all are serial awaits with no partial progress. | `App.tsx:1659-1705`, `LiveStatePanel.tsx:2373-2386` |
| H | No virtualization in inventory or Add to profile checklist; "Show all" renders everything. | `LiveStatePanel.tsx:1261-1264`, `ScopeAddToProfileModal.tsx:254` |
| H | Edit profile saves on blur with no dirty/discard guard; partial saves possible. | `EditProfilePane.tsx:323-374` |
| H | First-run empty state is passive ("Waiting for the sidecar to seed a default profile…"). A freshly bootstrapped project profile shows all 13 on-disk resources as **Inactive** with 13 repeated "Activate" verbs, which contradicts what the user just saw happen. | `App.tsx:2609-2623`, screenshot `08-scope-project` |
| M | Three add paths: rail ListPlus, inventory Add/Add all, FAB. | `App.tsx:2730-2752` |
| M | Auto Re-apply after Add hijacks the session with the full switch panel and no explanation. | `lib/reapply.ts:36-60`, `App.tsx:1691-1702` |
| M | Truncation: "Showing 12 of 13" with icon-only More / Show all; FAB overlaps the last row's action and the Show all control. | `LiveStatePanel.tsx` list paging, `styles.css:1862-1874` |
| M | Type pills wrap to 2 to 3 rows at ≤1100px with disabled zero-count pills adding noise. | `ResourceTypeTabs.tsx`, screenshots `70-*` |
| M | Confirm copy says "Switch anyway" while the CTA is Apply. Remove-profile confirm's destructive action is a blue primary with a check icon. | `App.tsx:3421`, `ConfirmDialog` usage, screenshot `69` |
| M | Edit profile copy: "No marketplaces registered. Add one in Settings." Marketplaces live in Discover. | `parity/PluginCompositionFields.tsx:91` |
| M | Add to profile modal offers the selected profile itself as a row ("global default" inside global default). | `ScopeAddToProfileModal.tsx` row source |
| M | Drag reorder is HTML5 DnD only, no keyboard alternative; drop indicator is an inset shadow. | `App.tsx:560-653`, `styles.css:613-622` |
| L | Rail pencil (edit pane) vs toolbar pencil (inventory edit mode) share one glyph. | DESIGN.md documents it; still confusable |

### 3.3 Library

| Sev | Finding | Where |
| --- | --- | --- |
| H | List replaced by "Loading resources…" on every reload (create, sync, update, library-changed). | `ResourcesPanel.tsx:194-217`, `578-610` |
| H | Whole filtered list mounted; no virtualization; search filters on every keystroke without debounce. | `ResourcesPanel.tsx:738-775`, `ResourceFilterSidebar.tsx:186` |
| H | Double-click-to-edit fields and title have no affordance beyond `cursor: text`. | `LibraryFieldRow.tsx:86-90`, `ResourceDetailBody.tsx:737-741` |
| H | Esc while a field is editing returns `"cancel-field"` and does nothing; user can get stuck in detail. | `ResourcesPanel.tsx:527-529`, `ResourceDetailBody.tsx:409-425` |
| H | Create-type picker maps `plugin` to `Package`; DESIGN.md says plugin packages use `Layers`. | `ResourceTypeModal.tsx:31` |
| H | Tracked directories modal auto-opens on **every** Library visit in a first-run session (`firstRun` never cleared). | `App.tsx:2846`, `ResourcesPanel.tsx:158-164` |
| M | Row body is not clickable; only the underlined name opens detail. No arrow-key navigation. | `ResourcesPanel.tsx:747-758`, `ui/resource-row.tsx:39-45` |
| M | Two Back arrows on detail (workspace header Back plus `LibraryDetailChrome` Back). Same on Discover tree/preview. | `ResourcesPanel.tsx`, `LibraryDetailChrome.tsx`, screenshots `40`, `50` |
| M | Detail shows a large yellow "Delete from library + disk is unavailable…" banner (sentence repeated twice) before the user expressed any delete intent. | `ResourceDetailBody.tsx` delete-plan banner, screenshot `41` |
| M | Plugin detail empty Resources says "Sync to load resources from the install tree." with no inline action; Sync lives in the header. | `PluginPackageDetail.tsx`, screenshot `40` |
| M | Update control does not pass `busy`; composition toggles await server with pane-wide `busy`; any mutation disables Back. | `PluginPackageDetail.tsx:849-886`, `1149-1208`, `ResourceDetailBody.tsx:244` |
| M | Seeded project resources appear twice in the flat list (`api` and `api@project default`) with no grouping or explanation. | data model plus `lib/library-list.ts`; screenshot `11` |
| M | Filter-empty state ("No matches.") has no Clear filters CTA; "updated" segment label "All time" wraps to two lines at 220px. | `ResourcesPanel.tsx:708`, `ResourceFilterSidebar.tsx` |
| M | `density="compact"` still exists on `ResourceTypeTabs` (DESIGN forbids icon-only pills). | `ResourceTypeTabs.tsx:42-43,76-77` |
| L | Create forms use native inputs; parity drawers use `ui/*`. Two tooltip systems (`ChromeTooltip` vs raw Radix in `LibraryFieldRow`). | `ResourceCreatePanel.tsx:74-145`, `LibraryFieldRow.tsx:40-69` |

### 3.4 Discover, Environments, Settings, Cloud, Migrate

| Sev | Finding | Where |
| --- | --- | --- |
| H | Discover verbs are opaque: marketplace hits expose only Pin to plugin; Cloud exposes Pull and Pin; standalones expose Attach. No "add to library" path for marketplace packages without a host plugin. | `lib/sources-record-actions.ts:74-96`, `SourcesRecordActions.tsx:62-96` |
| H | Environments: selecting another environment keeps the previous detail on screen until fetch completes. | `parity/EnvironmentsWorkspace.tsx:125-149` |
| H | Environment create has only name/description; values/secrets appear only in edit, so blank create → reopen Edit. | `parity/EnvironmentDrawer.tsx:112-118`, `421-621` |
| H | Settings footer Save/Cancel always target the harness draft; the Project tab has its own full-width Save (two Saves visible). No dirty guard on close. | `SettingsDrawer.tsx:175-181`, `428-451`, `682-692`; screenshot `21` |
| H | Migrate import/export close on success with no confirmation. Export step 1 is three tiny radios top-left of an otherwise empty full-screen panel. | `MigrateImportDrawer.tsx:164-177`, `App.tsx:3346-3366`; screenshot `22` |
| M | Search with no matches shows "You're caught up" (wrong message for a query miss). Every source toggle can flash "Searching…". | `SourcesListPane.tsx:81-99`, `SourcesWorkspace.tsx:334-410` |
| M | Add marketplace / Connect catalog / Pin to plugin are centered dialogs styled as the create-profile dialog with `aria-label`s saying "drawer"; DESIGN.md lists create/edit as full-screen panels. | `PinToPluginPanel.tsx:126-141`, `MarketplaceEditPanel.tsx:284`, `ConnectCatalogPanel.tsx:163` |
| M | Discover preview field rows misaligned (label for next field jammed under previous value). "Contained files" header renders with no content. | `SourcesPreviewPane.tsx`, screenshot `50` |
| M | Failed origin check reuses `actionError`, so it displays as if Pull/Pin failed. Pin closes its panel before a failure surfaces. | `SourcesWorkspace.tsx:484-507`, `PinToPluginPanel.tsx` |
| M | Settings harness list: centered labels in a ~5-row clipped scroll box; `apm.yml` editor is a bare textarea. | `SettingsDrawer.tsx:502-678`, `ProjectConfigInspect.tsx:208-224` |
| M | Environments Create is a bare `Plus` (not accent); Back arrow shown at the Environments list entrypoint (Library/Discover hide it). | `EnvironmentsWorkspace.tsx:214-223` |
| M | Dead code: `MarketplaceSettingsSection`, `PublishCatalogsSettings` not wired. | `components/parity/*` |
| L | Copy: "A environment", Cloud sign-in says "profiles" where product now says plugins/catalogs. | `EnvironmentDrawer.tsx:68`, `CloudAccountDrawer.tsx:476` |

### 3.5 Visual system (styles.css)

| Sev | Finding |
| --- | --- |
| H | Tokens are palette-only. Missing: spacing scale, type scale, elevation, motion durations/easings, z-index scale, hover/selected surfaces, focus ring variants, border tiers, disabled opacity. 50 inline `color-mix`, 407 `px` literals, 8 post-`:root` hex values, ad hoc z-index `-1, 1, 6, 30, 35, 40, 45, 50, 60, 80`. |
| H | 21 distinct font sizes; 83 declarations under 13px (DESIGN.md: dense metadata ≥13px, primary copy ≥16px). Workspace titles are 12px. |
| H | Fonts: Google Fonts `<link>` in `index.html`; no bundled `@font-face`. Offline or restricted egress falls back to Segoe UI / system mono, which the DESIGN.md anti-slop rule forbids. FOUT on each launch. |
| H | Interactive states: zero `:active` rules; `.btn`, `.icon-btn`, Settings tabs have no hover; focus ring is accent-on-accent for primary buttons (invisible). shadcn primitives use a different ring (`ring-[3px] ring-ring/50`). |
| H | Motion: 1 keyframe, 1 transition (reduced-motion reset), `prefers-reduced-motion` targets `.resource-hover-card` which has no motion (dead rule). |
| M | Duplication: 6 button families, 6 chip/pill/badge families, 9 section-header styles, 7 empty-state styles, 5 overlay/backdrop classes, 5 near-identical list-row styles. |
| M | No custom scrollbars; light OS scrollbars on dark panes. Dialog radius 8px vs `--radius` 0.25rem vs hover card 10px. One drop shadow in the whole app; no backdrop blur. |
| M | `--accent` as text on `--surface-2` is 4.29:1 (fails 4.5:1). Fallback `#6b7280` text is 3.3 to 3.8:1. |
| M | Only breakpoint is 720px. `ResourceTypeTabs` compact mode hides labels. FAB has no scroll padding below the last row. |

---

## 4. Design principles for the refresh

These extend DESIGN.md; they do not replace it.

1. **Last-good-value UI.** Never replace rendered data with a loading placeholder when a previous value exists. Refreshes dim or show a thin progress bar; only first loads show skeletons.
2. **Instant acknowledgement.** Every click changes something on screen within one frame: optimistic state, pressed style, spinner-in-place, or a step strip. Server truth reconciles afterwards; failures roll back with a toast that offers Retry.
3. **One motion vocabulary.** All motion comes from a small token set (durations, easings, four enter/exit recipes). No bespoke keyframes in feature CSS. Motion is short (80 to 280ms), physical (opacity plus small translate/scale), interruptible, and disabled under `prefers-reduced-motion`. Layout changes that would cause jumps (row add/remove, section expand) animate height; nothing else animates layout.
4. **One layer manager.** Overlays register in a stack; only the top layer receives Esc and traps focus; focus returns to the opener on close.
5. **One status sentence.** Each workspace header states where the user is and what state the thing is in, in words (`Selected · not applied`, `Active · drifted`), instead of stacking glyph, tint, badge, and dot.
6. **Every empty state has one next action** and says why it is empty.
7. **Tokens before pixels.** No new hex, `rgba`, `px` font-size, or ad hoc z-index in feature CSS. Biome cannot lint CSS; add a small script (`scripts/check-css-tokens.ts`) that fails preflight on new violations.

---

## 5. DESIGN.md amendments (required)

Land these edits with the WPs that implement them.

1. **Motion** (replaces "Motion: status color transitions and in-progress switch-step highlight only"):
   > Motion is functional, not decorative. Allowed: overlay enter/exit (opacity plus ≤8px translate or 0.98 scale, 120 to 180ms), pane swaps (crossfade 120ms), list row enter/exit and section expand/collapse (height plus opacity, ≤200ms), status color transitions (150ms), switch-step highlight (150ms), pressed state (80ms), skeleton shimmer (1.2s, reduced-motion: static). Forbidden: bounces, springs longer than 300ms, parallax, looping attention animations except spinners and the skeleton shimmer. All motion reads `--duration-*` / `--ease-*` tokens and is disabled by `prefers-reduced-motion`.
2. **Selection**: "Clicking a profile selects it. Re-clicking the selected profile keeps it selected (no toggle-deselect)."
3. **Add paths**: remove the rail ListPlus "add not-staged" control; inventory **Add** / **Add all** and the FAB are the two add paths (row-level and bulk).
4. **Status line**: the live-state header has a one-line status under the profile name: `Selected · not applied`, `Active · applied`, `Active · N files differ (Re-apply)`. This replaces the `active` badge next to the title (the rail keeps its `active` badge).
5. **Apply progress**: the yellow step list is an overlay strip at the top of the live pane; the inventory stays mounted and read-only underneath.
6. **Overlays**: Discover Add marketplace, Connect catalog, and Pin to plugin become full-screen panels (consistent with the existing overlay lock). Compact centered dialogs stay for confirms, type picker, resource inspect, file diff, publish picker, and Add to profile / Add to plugin.
7. **Back**: exactly one Back control per screen (the workspace header Back). Nested-pane chrome no longer renders a second Back.
8. **Tokens**: add spacing, type, elevation, motion, z-index, surface-state, focus-ring, border-tier, disabled-opacity tokens (list in WP1). "Do not invent extra palette roles" stays; the new tokens are not palette roles.
9. **Type scale**: `--text-micro` 12px is allowed only for uppercase eyebrows and mono counts in pills; all other metadata ≥13px; body 14px; primary field values 16px; titles 18 / 22px. (Today DESIGN says primary copy ≥16px, which is unrealistic for dense list rows; 14px body is the compromise. Confirm with the owner before WP1 starts.)
10. **Empty states** (new section): heading (≥16px), one sentence of why, one action. Search-miss copy is `No results for "<query>"` with **Clear search**; never "You're caught up" for a query miss.
11. **Fonts**: IBM Plex Sans and Mono are bundled with the app (no runtime CDN dependency).
12. **Window**: Tauri `minWidth` 960, `minHeight` 600. Header collapses utilities into a **More** menu below 1100px; project picker keeps a minimum 180px label.
13. **Keyboard**: `⌘/Ctrl+K` opens a command palette (destinations, profiles, settings, actions on the current screen); `⌘/Ctrl+1..3` jump to Library / Discover / Environments; `[` / `]` switch scope; `/` focuses the current workspace filter; `Esc` = dismiss top layer, else Back.

---

## 6. Work packages

Conventions for every WP:

- Branch from `main`; one PR per WP unless noted. Do not commit unless asked (repo rule); the PR is the deliverable.
- Run `bun run preflight` at the repo root and `cd apps/desktop && bun run build` before opening the PR.
- Add a Changie entry (`changie new`) for user-visible changes.
- Do not refactor outside the listed files. Match surrounding style (Biome formatter is off).
- Update `DESIGN.md` in the same PR when a WP changes a lock (see section 5).
- Verification screenshots: use the Playwright harness from WP0 and attach before/after PNGs to the PR.

### WP0. Dev harness: web-only mode and screenshot script

Why first: nothing else can be verified visually without it.

Files: `src/lib/agent-client.ts`, `apps/desktop/README.md`, new `apps/desktop/scripts/ui-shots.mjs`, new `apps/desktop/scripts/tauri-shim.js`, `apps/desktop/package.json` (script `shots`).

Tasks:
1. In `waitForHealth`, wrap `invoke("get_sidecar_port")` in its own try/catch so a browser without Tauri still tries the `VITE_AGENT_PORT` / 7474 candidates. Same for `connectAgent` (already guarded when `VITE_AGENT_URL` is set; make the guard unconditional). Also guard `listen("sidecar-reloaded")` (currently throws `Cannot read properties of undefined (reading 'unregisterListener')` in the browser).
2. Add `scripts/ui-shots.mjs`: starts nothing itself; expects `VITE_AGENT_URL`, a running Vite, and a token path; installs a Tauri IPC shim via `addInitScript` (answers `start_sidecar` / `get_sidecar_port` / `read_agent_token` / `plugin:event|listen` / `plugin:dialog|open`); walks a fixed list of screens (scope Global, scope Project, Library list/detail/create picker, Discover list/tree/preview, Environments, Settings tabs, Export, Import, Account) at 1440×900 and 960×640 and writes PNGs to `apps/desktop/e2e/artifacts/shots/`. Add `playwright` as a devDependency of `apps/desktop` (it is not currently installed; the e2e stack is WebdriverIO). Use the system Chrome via `channel: "chrome"` in CI to avoid downloading browsers.
3. Add `scripts/demo-home.sh`: assembles an isolated `HOME` from `test/fixtures/claude-plugins-home`, `cursor-plugins-home`, and a project from `cursor-project` + `claude-project`, then starts `bun src/agent/entry.ts` with `HARNESSTAP_TELEMETRY=0`.
4. README: document `bun run shots`.

Done when: `bun run dev` connects to a manually started agent in Chrome without Tauri; `bun run shots` produces ≥20 PNGs; no `pageerror` in the console.

### WP1. Design tokens and CSS restructuring

Files: `src/styles.css` → split into `src/styles/{tokens,base,motion,primitives,layout}.css` and `src/styles/features/{shell,scope,library,discover,environments,settings,dialogs,create}.css`; `src/styles.css` becomes an `@import` index. New `scripts/check-css-tokens.ts` wired into root `preflight`.

Tokens to add to `:root` (values are the proposal; keep palette hexes unchanged):

```css
/* spacing (4px base) */
--space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
--space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem;
/* type */
--text-micro: 12px;  /* eyebrows, pill counts only */
--text-meta: 13px;   /* dense metadata, mono paths, timestamps */
--text-body: 14px;   /* list rows, controls, form labels */
--text-value: 16px;  /* field values, primary copy */
--text-title: 18px;  /* pane titles */
--text-display: 22px;/* full-screen panel titles */
--leading-tight: 1.2; --leading-body: 1.45;
--tracking-eyebrow: 0.08em;
/* surfaces and borders */
--surface-hover: color-mix(in srgb, var(--surface-2) 70%, var(--fg) 4%);
--surface-selected: color-mix(in srgb, var(--accent) 14%, var(--surface));
--surface-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent);
--border-subtle: color-mix(in srgb, var(--border) 60%, transparent);
--border-strong: color-mix(in srgb, var(--border) 100%, var(--fg) 10%);
/* status tints (bg for banners/rows) */
--tint-green: color-mix(in srgb, var(--green) 12%, transparent);
--tint-yellow: color-mix(in srgb, var(--yellow) 12%, transparent);
--tint-red: color-mix(in srgb, var(--red) 12%, transparent);
/* focus */
--focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
--focus-ring-on-accent: 0 0 0 2px var(--accent), 0 0 0 4px var(--fg);
/* elevation */
--shadow-1: 0 1px 2px rgb(0 0 0 / 0.35);
--shadow-2: 0 6px 20px rgb(0 0 0 / 0.40);
--shadow-3: 0 16px 48px rgb(0 0 0 / 0.55);
--scrim: rgb(6 9 13 / 0.6);
/* z-index */
--z-sticky: 10; --z-fab: 20; --z-menu: 30; --z-panel: 40; --z-dialog: 50;
--z-popover: 60; --z-toast: 70; --z-tooltip: 80;
/* motion */
--duration-instant: 80ms; --duration-fast: 120ms; --duration-base: 180ms;
--duration-slow: 280ms; --duration-skeleton: 1200ms;
--ease-out: cubic-bezier(0.2, 0, 0, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
/* misc */
--opacity-disabled: 0.45;
--scrollbar-thumb: color-mix(in srgb, var(--muted) 35%, transparent);
--scrollbar-thumb-hover: color-mix(in srgb, var(--muted) 55%, transparent);
```

Tasks:
1. Create the token file and the `@theme inline` bridge (map `--color-*`, `--radius-*`, and `--shadow-*` so shadcn primitives read the same tokens; align shadcn focus ring to `--focus-ring`).
2. Split `styles.css` mechanically by selector prefix into the files above. No visual change in this step; verify with the WP0 screenshot diff (pixel-identical).
3. Replace font-size literals with `--text-*` tokens. Anything at 10 to 11px becomes `--text-micro` (12px) or `--text-meta` (13px) per the section 5 type scale. Workspace titles (`.resources-panel-title` etc.) go to `--text-title`.
4. Replace ad hoc z-index values with `--z-*`; replace the four `rgba` and eight hex one-offs; replace `color-mix` hover/selected recipes with `--surface-hover` / `--surface-selected`.
5. Base: dark scrollbars (`::-webkit-scrollbar` 10px with `--scrollbar-thumb`, `scrollbar-color` / `scrollbar-width: thin` for Gecko); global `:focus-visible` uses `box-shadow: var(--focus-ring)` and `.primary:focus-visible` uses `--focus-ring-on-accent`; `button:active:not(:disabled)` gets `transform: translateY(0.5px)` plus darker surface via token, 80ms.
6. `scripts/check-css-tokens.ts`: fails if any file under `src/styles/features` contains a hex color, `rgba(`, `font-size: <n>px`, or `z-index: <n>`; allow-list `tokens.css` and `base.css`.

Done when: screenshot diff vs `main` shows only the intended type-size and scrollbar/focus changes; `preflight` runs the CSS token check; `styles.css` index file is <40 lines.

### WP2. Bundled fonts

Files: `apps/desktop/package.json`, `index.html`, `src/styles/base.css`, `src/main.tsx`.

Tasks: add `@fontsource/ibm-plex-sans` (400, 500, 600) and `@fontsource/ibm-plex-mono` (400, 500); import the CSS in `main.tsx`; remove the Google Fonts `<link>`s and preconnects; set `font-display: block` for the sans face to avoid FOUT on launch; fix `.resource-create-textarea` to use `var(--mono)`.

Done when: DevTools network shows no `fonts.googleapis.com` request; text renders in IBM Plex with the network offline; Tauri `tauri.conf.json` CSP (if present) no longer whitelists Google Fonts.

### WP3. Motion system

Files: `src/styles/motion.css`, new `src/components/motion/{Presence.tsx,Collapse.tsx,Crossfade.tsx}`, `src/lib/motion.ts`.

Design:
- CSS recipes (all read tokens, all wrapped in `@media (prefers-reduced-motion: no-preference)`):
  - `.m-fade-in` / `.m-fade-out`: opacity 0→1, `--duration-fast`, `--ease-out`.
  - `.m-rise-in` / `.m-rise-out`: opacity plus `translateY(6px→0)`, `--duration-base`. For dialogs, FAB modal, toasts, banners.
  - `.m-scale-in` / `.m-scale-out`: opacity plus `scale(0.98→1)`, `--duration-fast`. For popovers, hover card, project-picker menu.
  - `.m-panel-in` / `.m-panel-out`: opacity plus `translateY(12px→0)`, `--duration-base`. For full-screen panels.
  - `.m-status`: `transition: color, background-color, border-color var(--duration-base) var(--ease-in-out)`. Applied to status glyphs, amber drift rows, switch steps, pills.
  - `.m-skeleton`: shimmer gradient, `--duration-skeleton` linear infinite; static under reduced motion.
- `Presence` component: keeps children mounted during exit, toggles `data-state="open|closed"`, calls `onExitComplete`. Implementation: `useState` + `onAnimationEnd`; no library. API: `<Presence open={bool} enter="m-rise-in" exit="m-rise-out">`.
- `Collapse`: animates `height` from measured `scrollHeight` to 0 and back (`grid-template-rows: 0fr→1fr` technique to avoid measuring), plus opacity. Used for inventory sections, Discover source groups, Settings sections, error banners.
- `Crossfade`: renders `key`-ed children; outgoing fades over `--duration-fast` while incoming fades in; container keeps `min-height` of the outgoing child during the swap to avoid layout jump. Used for workspace swaps and list↔detail.
- `lib/motion.ts`: `prefersReducedMotion()` and `motionDuration(token)` helpers for JS-timed sequences (toast auto-dismiss, success flash).
- Row enter/exit: inventory and library rows get `view-transition-name`-free CSS: new rows `m-fade-in`; removed rows use `Presence` with `m-fade-out` plus `Collapse`.

Tasks:
1. Write `motion.css` and the three components with unit tests for state sequencing (`bun test` in `apps/desktop`; tests may use `@testing-library/react` if added as devDependency).
2. Apply to: `ConfirmDialog`, `FullScreenPanel`, `ScopeAddToProfileModal`, `ResourceTypeModal`, `FileDiffModal`, `ResourceTrackedDirectoriesModal`, `UpdateAvailableControl` dialog, `TelemetryConsentModal` (fade only), `ProjectPicker` menu, `resource-hover-card`, `dialog-backdrop` (scrim fade), `.steps li` (`m-status`), inventory row drift tint, `PendingApprovalsStrip`.
3. Delete the dead reduced-motion rule; add the global reduced-motion guard in `motion.css`.
4. Confirm `tw-animate-css` is still needed for shadcn `Select` / `Popover`; if kept, map its durations to `--duration-fast` via `--tw-animate-duration`; otherwise remove the import.

Done when: every overlay in the WP0 screenshot walk has an enter and exit animation (record a 60fps video with Playwright `recordVideo` and check for frame drops with the Chrome tracing in `ui-shots.mjs --trace`); with `prefers-reduced-motion: reduce` emulated, no element animates.

### WP4. State architecture: agent session, status store, navigation

Why: WP5+ cannot deliver "instant" UI while every poll re-renders the entire tree.

Files: `src/App.tsx` (shrinks), new `src/state/{agent-session.ts,status-store.ts,navigation.ts,overlay-stack.ts,toast-store.ts}`, new `src/components/shell/{AppHeader.tsx,AppOverlays.tsx,ScopeWorkspace.tsx,ProfilesRail.tsx}`.

Design:
- `agent-session.ts`: `useAgentSession()` returns `{ baseUrl, token, phase: "connecting" | "connected" | "disconnected", error, retry }`. Owns connect, retry, `sidecar-reloaded`. Exposes a stable `client` object (bound `baseUrl`/`token`) so components stop threading both.
- `status-store.ts`: external store via `useSyncExternalStore`. Holds `status`, `profiles`, `stash`, `applyPreview` keyed by `{scope, projectPath, profile}`, `harnessSnapshotComplete`, and per-key `refreshing` flags. Poll loop lives here (activity-gated, 2s fast, generation counter per request so late responses are dropped, `AbortController` on unmount). Selectors: `useStatus(selector)` so `LiveStatePanel` subscribes only to what it renders. **Rule: setters never clear a value to `null` before a refetch;** they set `refreshing: true` and replace on success.
- `navigation.ts`: `useNavigation()` with `{ destination: "library" | "discover" | "environments" | "scope", scope: "global" | "project", nested: stack, back(), go(dest), resetCurrent() }`. History contains destinations only; scope is orthogonal. `Esc` = `dismissTopLayer() || back()`. Renames `sources`→`discover`, `home`→`global` throughout (`ViewScope`, `WorkspaceFocus`, test ids; keep API payload values via a mapping in `lib/api`).
- `overlay-stack.ts`: `useOverlayLayer({ open, onClose, closeDisabled })` registers a layer id; one `window` keydown listener dispatches Esc to the top layer only; the hook also traps focus (Tab cycling within the layer root) and restores focus to the previously focused element on close. Replace the 11 ad hoc listeners and `useDialogDismiss`.
- `toast-store.ts`: `toast({ tone: "success" | "error" | "info", title, detail?, action?: { label, onClick } })`, queue of max 3, auto-dismiss 4s (success) / sticky (error), `aria-live="polite"` region rendered by `AppOverlays`. Replace every `setSuccessMessage` + `setTimeout` and the `.success-flash` header text. Banner API for inline errors: `<Banner tone onRetry? onDismiss?>` used by all four current variants.

Tasks:
1. Extract stores and hooks with unit tests (`generation counter drops stale`, `no null-before-refetch`, `overlay stack Esc routes to top`).
2. Move rail JSX to `ProfilesRail.tsx`, header to `AppHeader.tsx`, overlays to `AppOverlays.tsx`, scope pane to `ScopeWorkspace.tsx`. `App.tsx` target: <400 lines.
3. Wrap `ResourcesPanel`, `SourcesWorkspace`, `EnvironmentsWorkspace` in `React.memo` and mount only the active one inside `Crossfade` (from WP3); they keep their own state via the stores so switching back is instant.
4. SSE: retry `subscribeSwitchEvents` twice with 500ms/1500ms backoff before surfacing `onError`.
5. Fix `hasFullHarnessSnapshot` reset (only when `baseUrl` changes).

Done when: React Profiler shows a status poll re-renders only `LiveStatePanel` subtree components that read changed fields; `App.tsx` <400 lines; all existing e2e (`bun run desktop:e2e`) pass; Esc with a confirm open over a full-screen panel closes only the confirm.

### WP5. Shell: header, responsiveness, loading and disconnected states

Files: `src/components/shell/AppHeader.tsx`, `src/styles/features/shell.css`, `src-tauri/tauri.conf.json`, new `src/components/shell/{HeaderMoreMenu.tsx,ConnectSplash.tsx,Skeleton.tsx}`.

Design:
- Header grid: `[brand] [destinations] [scope] [project cluster (flex 1, min 180px)] [utilities]`. Below 1100px, utilities (Refresh, Export, Import, Settings, Account, Update) collapse into a **More** (`Ellipsis`) menu except Refresh and Settings. Below 960px destinations drop labels to icons with tooltips (still ≥32px hit). Brand text never clips: `flex: 0 0 auto`, and destinations get `min-width: 0` with `overflow: hidden` before the brand does.
- Tauri: `minWidth: 960`, `minHeight: 600`.
- `aria-current="page"` on the active destination; `aria-pressed` on scope segment.
- `ConnectSplash`: first connect shows the brand, a thin indeterminate bar, and the phrase `Starting the agent…`; on failure it shows the error with **Retry** and **Open logs**. The shell is not painted until `phase === "connected"` the first time; later disconnects keep the last-good UI dimmed (`opacity: 0.6`, `pointer-events: none` on `main`) with a top banner `Reconnecting…` that offers Retry after 5s.
- `Skeleton` primitive: `<Skeleton lines={3} />` and `<SkeletonRow count={8} />` using `.m-skeleton`; used for rail and inventory first load, Library first load, Discover first fetch, Environments first load.
- Switch step list: `state === "failed"` gets class `failed` (red text, `CircleX` glyph, label `failed`); `.steps li` uses `.m-status`.
- `UpdateAvailableControl`: on check failure keep the last known status; expose `Check for updates` in Settings → Advanced.

Done when: header renders correctly at 960, 1100, 1440 (screenshots); no element overlaps at any width ≥960; first launch shows the splash then the shell; killing the agent shows dimmed UI plus banner, restarting it recovers without reload.

### WP6. Scope workspace: selection model, apply flow, inventory

Files: `src/components/shell/ProfilesRail.tsx`, `src/components/LiveStatePanel.tsx` (split into `src/components/live/{LiveHeader.tsx,InventorySection.tsx,InventoryRow.tsx,TargetPreviewPane.tsx,FileChangesSection.tsx,InstallGapsSection.tsx,ScopeInventoryShell.tsx,ApplyProgressStrip.tsx}`), `ScopeAddToProfileModal.tsx`, `EditProfilePane.tsx`, `lib/reapply.ts`, `lib/profile-inventory.ts`.

Design:
- **Selection**: re-click keeps selection. Clear via rail filter X only when a filter is active; otherwise there is always a selected profile (fallback to active, then first).
- **Status line** under the profile name (DESIGN amendment 4): `Selected · not applied` | `Active · applied` | `Active · N files differ` with `View changes` as a text link that opens Target preview. The `active` pill next to the title is removed; the rail keeps its badge.
- **Apply CTA helper**: under the rail Apply button: `N changes · Preview` when the selected profile is not active and the preview has a delta; `Up to date` when applied and clean. Apply is disabled only when there is nothing to do, and the helper says so.
- **Apply progress**: `ApplyProgressStrip` at the top of the live pane (yellow tint, steps in a horizontal list with `m-status`, Cancel disabled during the apply step); inventory stays mounted below at `opacity: 0.7`, `pointer-events: none`. On success the strip turns green for 1.5s then collapses (`Collapse`), and a toast confirms.
- **Optimistic mutations**: Add / Activate / Remove move the row between sections immediately (row keeps a `pending` state: spinner in the action slot, no opacity change). Server response reconciles; failure moves the row back and toasts with Retry. Add all / Activate all show `Adding 3 of 12…` in the section header and update rows as each completes (`Promise.allSettled` over chunks of 4).
- **Auto Re-apply after Add**: keep the behavior but do not swap panes; the progress strip appears with the label `Applying to match profile`, and the toast says `Added <name> and applied`.
- **Remove the rail ListPlus** not-staged control. Keep inventory **Add all** and the FAB.
- **Activate**: hidden unless the selected profile is active; when the selection is not active, Inactive rows show no per-row verb and the section header says `Applies when you Apply this profile`.
- **Inventory density**: rows are `[type icon] [name] [subtitle?] …… [action]`; the leading status glyph is dropped for Active and Inactive rows (section already says it) and kept only for drifted rows (amber `m-status`). Names are not underlined (link styling removed; whole row is a button with hover surface). Row height fixed at 40px for virtualization.
- **Virtualization**: `@tanstack/react-virtual` for inventory sections (each section virtualizes its own list inside a shared scroll container) and the Add to profile checklist. Remove the `LIST_PAGE_SIZE` More / Show all controls. FAB container gets `padding-bottom: 72px` on the scroll area so the last row is never covered.
- **Type pills**: in the scope inventory, zero-count types collapse into a trailing `+N empty` pill (tooltip lists them) instead of rendering 5 disabled pills; DESIGN.md's "empty real types stay visible and disabled" is amended to this behavior.
- **Add to profile modal**: exclude the selected profile's own package; `useDeferredValue` on the search; dialog height follows content up to 70vh (not fixed).
- **Edit profile pane**: explicit **Save** / **Discard** footer for name/description/tags with dirty tracking; Back/Esc on dirty asks to discard. Composition toggles stay immediate but each toggle toasts with **Undo**. Fix copy: `No marketplaces registered. Add one in Discover.`
- **Drag reorder**: add a drag handle (`GripVertical`) visible on hover/focus; keyboard `Alt+↑/↓` on a focused row reorders; drop indicator is a 2px accent line between rows.
- **Confirms**: destructive confirms use `tone="destructive"` (red filled button, `Trash2` icon); copy `Apply anyway` / `Re-apply anyway`.
- **First run / empty**: with no profiles, main pane shows `Create your first profile` (heading), one sentence, and a primary **Create profile** that opens Create with Compose preselected; after create, select it and show the Apply helper `N changes · Preview`. Project scope with no `apm.yml`: main pane shows the bootstrap banner by default (not only after a preview warning). After project bootstrap, the seeded profile is auto-applied by the agent (confirm with the CLI owner; if not feasible, the empty Inactive section header explains: `Found on disk. Apply to track these with this profile.`).

Done when: e2e covers select→preview→apply with the inventory visible throughout; a 200-row inventory scrolls at 60fps (Playwright trace); Add on a row moves it within one frame; screenshots at 960px show pills on one row with the `+N empty` overflow.

### WP7. Library

Files: `ResourcesPanel.tsx`, `ResourceFilterSidebar.tsx`, `ResourceDetailBody.tsx` → `src/components/library/{useResourceDetail.ts,ResourceDetailActions.tsx,ResourceDetailFields.tsx,ResourceDeleteConfirm.tsx}`, `PluginPackageDetail.tsx` → `src/components/library/{usePluginPackageDetail.ts,PluginPackageHeaderActions.tsx,PluginCompositionSection.tsx,PluginPackageFieldEditors.tsx,PluginPackageConfirmHost.tsx}`, `LibraryFieldRow.tsx`, `LibraryDetailChrome.tsx`, `ResourceTypeModal.tsx`, `ResourceTypeTabs.tsx`, `ui/resource-row.tsx`, `lib/library-list.ts`.

Design:
- **Reload without flicker**: `reloadLibrary` keeps rows and sets `refreshing`; header Refresh icon spins; new rows enter with `m-fade-in`.
- **Virtualized list** (`@tanstack/react-virtual`), fixed 44px rows (56px when a subtitle exists: compute height per row from data, both stable).
- **Row activation**: whole row opens detail; nested controls stop propagation. `role="listbox"` / `role="option"`, roving `tabIndex`, `↑/↓/Home/End`, `Enter` opens, typeahead by first letters. Remember the last opened selector and highlight it on Back (`aria-current`).
- **Search**: `useDeferredValue` in the sidebar; filtering memoized per facet.
- **Namespaced duplicates**: rows whose name differs only by `@<profile>` suffix group under the base name with a mono `@project default` chip; hover card explains `Scoped copy in project default`. (If the data layer can dedupe at seed time, prefer that; coordinate with `src/` owners.)
- **Detail edit affordance**: field rows show a `Pencil` icon-action on hover/focus (tooltip `Edit`); single click on the value or Enter on the focused row starts editing; double-click continues to work. Multiline content gets explicit **Save** / **Cancel** buttons under the textarea; single-line commits on Enter/blur, cancels on Esc. Title uses the same affordance.
- **Esc fix**: `"cancel-field"` calls a detail-provided `cancelFieldEdit()`; Esc never no-ops.
- **Delete plan banner**: not shown by default; the blocker reason appears inside the Delete confirm and as a small `Info` icon-action next to Delete (tooltip `Disk delete blocked`). The banner returns only when the user opens Delete.
- **One Back**: `LibraryDetailChrome` no longer renders Back when hosted inside a workspace that has the header Back; keep it for the standalone inspect dialog.
- **Plugin detail empty Resources**: `Nothing loaded yet.` plus an inline labeled **Sync** button.
- **Feedback**: `busy` on Update; optimistic composition toggles with rollback; `actionsLocked` disables only the in-flight control and destructive peers; Back stays enabled unless a confirm is open.
- **Type picker glyph**: `plugin: Layers`; source glyphs from `resourceTypeGlyph` only. Close control via `IconActionButton`.
- **Remove `density="compact"`** from `ResourceTypeTabs`; keep `overflow="collapse"`. Measure `N more` with the real count label.
- **Filter sidebar**: "updated" segment becomes a `Select` (All time / 1d / 7d / 30d / 90d / Custom) so labels never wrap at 220px; section labels use the eyebrow recipe. Filter-empty state: `No matches for "<q>"` plus **Clear filters**.
- **Tracked directories first-run**: open once per install (persist `trackedDirsIntroSeen` in the agent config via the existing telemetry-consent style endpoint or `localStorage` as a fallback); never re-open on subsequent Library visits.
- **Forms**: `ResourceCreatePanel` uses `ui/input`, `ui/textarea`, `ui/select`, `ui/checkbox`; field help under inputs where the schema has `description`. On create success, toast `Created <name>` in addition to landing on detail.

Done when: 1,000-row fixture library filters within 16ms per keystroke (Playwright trace); reload never shows "Loading resources…" after first load; keyboard-only user can open, edit, and leave a detail; screenshot of detail shows no yellow banner until Delete is opened.

### WP8. Discover

Files: `SourcesWorkspace.tsx` → `src/components/discover/{useDiscoverSources.ts,useDiscoverSearch.ts,useDiscoverPane.ts,useDiscoverInstallActions.ts,DiscoverWorkspace.tsx}`, `SourcesListPane.tsx`, `SourcesPluginTree.tsx`, `SourcesPreviewPane.tsx`, `SourcesRecordActions.tsx`, `PinToPluginPanel.tsx`, `MarketplaceEditPanel.tsx`, `ConnectCatalogPanel.tsx`, `lib/sources-record-actions.ts`.

Design:
- **Verbs**: rename and unify. Primary per hit: **Add to Library** (labeled accent button, icon `Download`) for anything not yet in the library (Cloud pull and marketplace package install both map here). Secondary icon-only: **Pin to plugin** (`Pin`, tooltip explains `Link into an authored plugin`), **Open in Library** when already present. `Attach` is folded into Pin (same picker, "attach" wording in the picker body). A one-line muted helper under the action cluster on the tree/preview: `Add copies it into your Library. Pin links it into one of your plugins.`
- **Pin picker**: always offers **Create plugin** as a secondary action; stays open on failure and shows the error inline.
- **Panels**: Add marketplace, Connect catalog, Pin to plugin become `FullScreenPanel`s; `aria-label`s stop saying "drawer".
- **Search states**: `Searching…` only on first fetch per source id; later refetches keep the list and show a small spinner in the sidebar header. Query miss: `No results for "<q>"` + **Clear search**; only the true no-new-items case shows `You're caught up`.
- **Sidebar**: when `All sources` is checked, child checkboxes render unchecked at full opacity (not faded), so they do not look disabled.
- **Errors**: `originCheckError` banner separate from `actionError`.
- **Preview pane**: reuse `LibraryFieldRow` grid so label/value/icon align; hide `Contained files` when empty; sign-in banner uses a labeled **Sign in** button.
- **One Back**; `Crossfade` on list ↔ tree ↔ preview.
- **Rows**: use `ResourceRowRoot` from `ui/resource-row.tsx` (same hover/selected/focus recipe as Library) with `InUseMark` when in library.

Done when: a new user can add a marketplace plugin to the Library in ≤3 clicks from the Discover list; screenshots show labeled primary action per hit; no "drawer" in any `aria-label`.

### WP9. Environments, Settings, Cloud, Migrate

Files: `parity/EnvironmentsWorkspace.tsx`, `parity/EnvironmentDrawer.tsx`, `SettingsDrawer.tsx`, `parity/ProjectConfigInspect.tsx`, `parity/SettingsParitySections.tsx`, `CloudAccountDrawer.tsx`, `MigrateImportDrawer.tsx`, `MigrateExportDrawer.tsx`, `App.tsx` (migrate handlers). Move `parity/*` that survives into `components/environments/` and `components/settings/`; delete `MarketplaceSettingsSection.tsx`, `PublishCatalogsSettings.tsx`, `ParityChrome.tsx`.

Design:
- **Environments**: selecting a row sets `detail` to a skeleton immediately (or keeps the old detail dimmed with `refreshing`); list first load uses `SkeletonRow`. Create panel includes a minimal values section (key/value rows with add/remove) and a `Secrets` hint; after create, land on detail. Create is accent `primary`. Back hidden at the list entrypoint (match Library/Discover). Detail values get a **Copy all** icon-action and a mask toggle for values that look like secrets (`*_KEY`, `*TOKEN*`, `*SECRET*`).
- **Settings**: footer Save/Cancel render only on the Harnesses tab; Project and Advanced save inline. Dirty guard on Back/Esc/Cancel (confirm discard). Harness list rows are left-aligned `[icon] [name] …… [checkbox]` at 40px, list height follows content up to 320px. `apm.yml` editor: keep a textarea but add line numbers gutter, mono at `--text-meta`, and inline error markers from validation (line numbers parsed from the validator messages when available). Add `Check for updates` and `Reset telemetry choice` to Advanced.
- **Cloud**: waiting state shows a spinner next to `Waiting for approval…`; copy updated to plugins/catalogs.
- **Migrate**: quiet step indicator (`Step 2 of 5`) in the panel subtitle; step body content centered in a 640px column like Settings; success toast with the output path (`Exported to ~/Downloads/harnesstap-2026-09-18.zip` with **Reveal**) or import summary (`Imported 12 resources, 2 plugins`).
- Copy fixes: `An environment…`.

Done when: Settings Project tab shows exactly one Save; switching environments never shows stale values; export and import both end with a toast; screenshots of Export step 1 show a centered form column.

### WP10. Keyboard, command palette, shortcuts

Files: new `src/components/shell/CommandPalette.tsx`, `src/lib/commands.ts`, `src/state/navigation.ts`, `DESIGN.md` (amendment 13), `README.md` (shortcut table).

Design:
- `cmdk`-style palette built on the existing `ui/combobox.tsx` primitives (no new dependency unless `cmdk` is already acceptable; check bundle size). Opens with `⌘/Ctrl+K`. Sections: **Go to** (Library, Discover, Environments, Global, Project, Settings, Account), **Profiles** (select / apply), **Actions on this screen** (registered by the active workspace via `useRegisterCommands([...])`), **Recent projects**.
- Shortcuts registered in one place (`lib/commands.ts`) with a `?`-triggered cheat sheet dialog.
- `Esc` semantics from WP4: dismiss top layer, else Back.
- Row lists (Library, inventory, Discover, Environments) share the listbox keyboard recipe from WP7.

Done when: every destination and the top 10 actions are reachable without a mouse; the cheat sheet lists them; e2e exercises `⌘K → Library`.

### WP11. Empty states, copy pass, micro-interactions

Files: new `src/components/EmptyState.tsx`; copy edits across components; `src/styles/primitives.css`.

Design:
- `EmptyState { icon?, title, body, action?: { label, onClick, primary? } }` with a single visual recipe (centered, 320px max width, `--text-title` heading). Replace the seven ad hoc empty styles.
- Inventory of every empty/miss state and its copy, following the section 5 empty-state rule. Review all UI strings against the Voice section of DESIGN.md (no em dashes, one idea per string, verbs users do).
- Micro-interactions: pressed state on all buttons and rows (from WP1 tokens), hover raise on FAB (`--shadow-2`), checkbox check animates (`m-scale-in` on the indicator), tooltip enter with `m-scale-in` at 400ms delay (existing), status pill color transitions `m-status`, success toast icon draws in (`stroke-dashoffset` 240ms).
- Primary button focus ring visible on accent (`--focus-ring-on-accent`).

Done when: screenshot walk shows no bare "No matching resources." / "No matches." strings; every empty state has an action or a reason.

### WP12. Verification and guardrails

Files: `.github/workflows/desktop-e2e.yml`, `apps/desktop/e2e/*`, `apps/desktop/scripts/ui-shots.mjs`, `apps/desktop/e2e/visual/` (baselines).

Tasks:
1. Visual regression: `ui-shots.mjs --compare` diffs against committed baselines at two viewports using `pixelmatch`; threshold 0.2%; run in the nightly desktop-e2e workflow (web mode against the agent, no Tauri needed).
2. Motion audit: `ui-shots.mjs --trace` records a Chrome performance trace for open/close of each overlay and a 200-row list scroll; script asserts no frame >32ms.
3. Accessibility: `@axe-core/playwright` on each screenshot page; fail on `serious` / `critical`.
4. Reduced motion: repeat the walk with `reducedMotion: "reduce"` and assert `getAnimations().length === 0` after each interaction.
5. Add `bun run desktop:check` = shots + compare + axe, referenced from `CONTRIBUTING.md`.

---

## 7. Dependency order and parallelism

```
WP0 ──► WP1 ──► WP2
 │       │
 │       ├──► WP3 ──┐
 │       │          ├──► WP5 ──► WP6 ──► WP10 ──► WP11 ──► WP12
 │       └──► WP4 ──┤        ├──► WP7
 │                  │        ├──► WP8
 └──────────────────┘        └──► WP9
```

- WP0 first. WP1 and WP2 are independent after WP0 but WP1 should land before any feature WP so tokens exist.
- WP3 and WP4 can run in parallel (different files) once WP1 is merged.
- WP6, WP7, WP8, WP9 are independent of each other and can run as four parallel agents after WP5. They touch disjoint component trees; the only shared file is `DESIGN.md` (merge conflicts are text-only).
- WP10 and WP11 need all workspaces landed. WP12 last, but the WP0 harness should be used for evidence from WP1 onwards.

Suggested agent briefing per WP: link this document, the WP section, `DESIGN.md`, `AGENTS.md`, and the WP0 screenshot instructions; require before/after screenshots in the PR; require the DESIGN.md amendment in the same PR.

---

## 8. Risks and open questions

1. **Type scale**: DESIGN.md says primary copy ≥16px. Dense list rows at 16px will roughly halve row density. Proposal uses 14px body / 16px field values (amendment 9). Needs owner sign-off before WP1.
2. **Auto-apply after project bootstrap** (WP6) changes agent behavior in `src/agent`; if the CLI owners decline, the UI copy fallback is specified.
3. **Namespaced duplicate rows** (WP7) may be a seed-time data issue; the UI grouping is a fallback.
4. **Virtualization plus `Collapse`** on sections: virtualized lists inside animating heights need care (measure after animation end). `Collapse` should skip animation when the section has >50 rows.
5. **`tw-animate-css`** may be removable; verify shadcn `Select` / `Popover` still animate via `motion.css` recipes.
6. **Tauri `minWidth` 960** may affect users on small laptops with side-by-side windows; 900 is the floor at which the WP5 header still fits.
7. **Bundle size**: `@fontsource` adds ~300KB of woff2; acceptable for a desktop binary. `@tanstack/react-virtual` ~15KB.

---

## 9. Appendix: files by size (for splitting targets)

| File | Lines | Target after refresh |
| --- | ---: | ---: |
| `src/styles.css` | 5218 | index <40; largest feature file <800 |
| `src/App.tsx` | 3455 | <400 |
| `src/components/LiveStatePanel.tsx` | 2462 | <400 (data derivation and composition only) |
| `src/components/PluginPackageDetail.tsx` | 1727 | <300 |
| `src/components/SourcesWorkspace.tsx` | 1356 | <250 |
| `src/components/ResourceDetailBody.tsx` | 1282 | <300 |
| `src/lib/agent-client.ts` | 1143 | unchanged (API surface), plus retry in SSE |
