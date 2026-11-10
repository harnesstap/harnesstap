# HarnessTap design system

The rules every UI and copy change in this repo follows: CLI (`src/`) and Desktop (`apps/desktop/`).

## Which file wins

| File | Owns | Precedence |
|---|---|---|
| `DESIGN.md` (this file) | Tokens, color rules, type scale, voice, UX rules, motion, enforcement | **Wins** on all of these |
| `apps/desktop/DESIGN.md` | Per-screen reference: layouts, screen recipes, exact labels and tooltips | Wins only on screen specifics this file does not cover |

If the two disagree on a token, a voice rule or a UX rule, follow this file and fix `apps/desktop/DESIGN.md` in the same PR. If you cannot tell which applies, open a `design-proposal` (section 9).

- `design-tokens.json` holds every hex in machine-readable form. CSS and `src/ui/theme.ts` must match it.
- `docs/design-decisions.md` is the dated log of what is Locked and what is only Proposed. Do not reopen a Locked item without a new reason.

Status words used below: **Locked** (decided, build it), **Proposed** (recommended, waiting for the maintainer's yes; do not ship it on your own). Everything in this file is Locked as of 2026-11-09 unless a row says otherwise. Some Locked tokens are not in the CSS yet; they land in the order of section 2.

## 1. Registers

HarnessTap has two visual registers. They share colors and voice; they differ in type, radius and density.

| Register | Used by | Type | Radius | Density |
|---|---|---|---|---|
| **Ops** | Desktop app, CLI output | IBM Plex Sans, IBM Plex Mono | 4px everywhere; pills only for type tabs and small filter chips | Dense, 4px spacing scale |
| **Brand** | harnesstap.com (marketing, docs, login, catalog). Not in this repo. | Onest body, Bricolage Grotesque display | Pill CTAs, rounded cards | Generous |

Everything in this repo is Ops. Do not import brand fonts, pill CTAs, glass cards or marketing gradients into Desktop.

## 2. Theme model

| Item | Rule | Status |
|---|---|---|
| Themes | Light, Dark, System. System follows `prefers-color-scheme`. | Locked; Desktop is dark only until the Light/System step ships |
| Storage | One key, `harnesstap-theme`, values `light`, `dark`, `system`. Default `system`. | Locked |
| Control | Settings only (Advanced tab), a three-way control named "Color theme". Never in the header. | Locked |
| Attribute | `data-theme` on `<html>`. Surfaces flip; brand and action hues do not. | Locked |
| Reduced motion | No theme transition animation. | Locked |

Ship order (Locked): action tokens first (done, [harnesstap#646](https://github.com/harnesstap/harnesstap/pull/646)), Desktop Light and System last. Until that last step ships, Desktop `:root` is the dark ramp below.

## 3. Color

Use tokens, never raw hex. Names below are the semantic names in `design-tokens.json`; the current CSS variable is in brackets when it differs. The shared palette is Locked (2026-11-09). Action tokens, status pairs and links shipped in [harnesstap#646](https://github.com/harnesstap/harnesstap/pull/646).

### Brand and action (same in every theme)

| Token | Hex | Use |
|---|---|---|
| `brand-blue` [`--accent`] | `#3B82F6` | The mark, Flow Split middle stop, focus ring, selection rail. Not a fill under text, not text on dark raised surfaces. |
| `brand-violet` | `#8B5CF6` | Flow Split start. Accent only. |
| `brand-teal` | `#14B8A6` | Flow Split end. Never under white text. |
| `action-primary` | `#2563EB` | Filled primary buttons (white text 5.17:1). Never text on dark. |
| `action-primary-hover` | `#1D4ED8` | Hover of the above (6.70:1). |
| `action-primary-fg` | `#FFFFFF` | Text on action fills. |
| `action-primary-ring` | `#3B82F6` | Focus ring, including on filled controls. |
| `violet-fill` | `#7C3AED` | Only if a violet fill with white text is ever needed (5.70:1). |
| `success-fill` | `#0F766E` | Teal-family fill under white text (5.47:1). |
| `danger-fill` / `-hover` | `#DC2626` / `#B91C1C` | Confirm button inside a destructive dialog only. |
| `brand-warn` | `#E6B84D` | Takes ink `#0F172A` on top, never white. |

The Flow Split gradient (violet to blue to teal) is for the mark, borders and accents. Never fill a surface that carries text with it.

### Surfaces and text

| Token | Dark | Light | Use | Status |
|---|---|---|---|---|
| `bg` | `#0F1419` | `#F8FAFC` | App canvas | Locked |
| `surface` | `#161B22` | `#FFFFFF` | Panes, sections | Locked |
| `raised` [`--surface-2`] | `#1C2330` | `#F1F5F9` | Inputs, chips, raised rows | Locked |
| `overlay` | `#222A38` | `#FFFFFF` | Popovers, menus | Locked, not in CSS yet |
| `hover` [`--surface-hover`] | `#212937` | `#EEF2F7` | Row and control hover | Locked, hex replaces color-mix |
| `selected` | `#182742` | `#EBF1FD` | Selected row, active segment | Locked; dark shipped |
| `border` | `#2A3340` | `#E2E8F0` | Decorative dividers only | Locked |
| `border-strong` | `#3A4555` | `#CBD5E1` | Secondary buttons, segmented controls | Locked, hex replaces color-mix |
| `border-control` | `#5B6878` | `#8492A6` | Input, checkbox, radio outlines (3:1) | Locked, not in CSS yet |
| `fg` | `#E8EEF5` | `#0F172A` | Body text | Locked |
| `muted` | `#94A3B8` | `#475569` | Secondary text, meta | Locked; dark shipped |
| `link` | `#60A5FA` | `#2563EB` | Text links, blue text on dark | Locked; dark shipped |
| `link-hover` | `#93C5FD` | `#1D4ED8` | Link hover | Locked; dark shipped |

The dark ramp is a cool blue-grey (hue about 215), not neutral zinc. Keep it.

### Status

Status is a tinted pair (text on its own background), always with a label or icon. Never color alone. Locked; shipped in [harnesstap#646](https://github.com/harnesstap/harnesstap/pull/646) except dark success text: Desktop `--green` is still `#14B8A6` and moves to `#2DD4BF`.

| Status | Dark fg on bg | Light fg on bg |
|---|---|---|
| Success [`--green`] | `#2DD4BF` on `#163134` | `#0F766E` on `#F0FDFA` |
| Warning [`--yellow`] | `#E6B84D` on `#2F2E27` | `#92400E` on `#FFFBEB` |
| Danger [`--red`] | `#F87171` on `#342127` | `#B91C1C` on `#FEF2F2` |
| Info | `#60A5FA` on `#1B2940` | `#1D4ED8` on `#EFF6FF` |
| In-use mark (Global fill) | `#22C55E` | `#16A34A` |

### Hard color rules

1. Filled primary is always `action-primary` with white text. Never fill with `brand-blue`, `brand-teal`, `brand-violet`, `brand-danger` or the gradient.
2. Never white text on `#3B82F6` (3.68:1), `#14B8A6` (2.49:1), `#8B5CF6` (4.23:1) or `#EF4444`.
3. Blue text on dark uses `link`, not `action-primary` or `brand-blue`.
4. Danger fill exists only for the destructive dialog's confirm button. Everywhere else danger is the tinted pair.
5. One filled primary per action cluster.
6. Text meets 4.5:1, UI boundaries and focus rings 3:1. `ci` checks every pair in `design-tokens.json`.

## 4. Type, space, shape

| Token | Value | Use |
|---|---|---|
| Font | IBM Plex Sans 400/500/600, bundled | All UI text. No runtime font CDN. |
| Mono | IBM Plex Mono 400/500 | Paths, versions, timestamps, counts, content |
| `--text-micro` | 12px | Uppercase eyebrows, mono counts in pills |
| `--text-meta` | 13px | Dense metadata (4.5:1 required) |
| `--text-body` | 14px | Rows, controls, labels |
| `--text-value` | 16px | Field values, primary copy |
| `--text-title` / `--text-display` | 18px / 22px | Pane and dialog titles / full-screen panel titles |
| `--radius` | 4px | Everything except type tabs and small chips (pill) |
| `--space-1` to `--space-8` | 4px base | All spacing |
| Hit target | 32px minimum (24px for trailing chip actions) | Icon chrome |
| Focus | 2px `bg` gap plus 2px `brand-blue` ring | Every focusable control |

No `font-size`, `z-index`, hex or `rgba()` literals outside the token files. Use the `--z-*`, `--duration-*` and `--ease-*` scales.

## 5. CLI

- Hexes live in `src/ui/theme.ts` and must match `design-tokens.json`. Respect `NO_COLOR` and non-TTY output.
- Filled badges use `#2563EB` with white text. Text colors assume an unknown terminal background, so status text uses the brand hues, never a fill.
- Change glyphs: `+` added, `−` removed, `~` modified. Success `✓`, warning `⚠`, failure `✗`.
- Output style: one line, one hint, quoted names, always `ht` in examples. Apply summary reads `Wrote N, removed M, kept K, unchanged U`. Hide zero parts only in prose, never in machine output.

## 6. UX rules

| Rule | What it means | Status |
|---|---|---|
| **One path per action** | No dual Apply, no second control for the same job unless it earns it (different outcome, audience or recovery). No status words that repeat what tint plus counts already say. | Locked |
| **Quiet icon, then confirm** | Destructive or disk-mutating actions are a quiet icon button that opens a confirm modal: reason first, then the confirm button. No inline noisy action stacks in rows. | Locked |
| **Zero-count types never hide in Library** | Library type tabs never hide a type because its count is 0. It renders as a muted pill with `0` and a short tooltip (for example "No plugins in your library yet"). | Locked |
| **Scope is a quieter segment** | Global / Project is a Scope segment on the Profile page, visually quieter than and separate from the destination tabs. | Locked |
| **Per-resource harness scope** | All is the silent default (no chrome). A subset shows up to 3 harness icons plus `+N`, which opens a "Use on" popover with Select all and None. Closing with zero checked reverts. All is stored as a sentinel. Harnesses sharing a folder are one linked row. Hidden at 0 or 1 harness. | Locked |
| **Icon-only chrome** | Every icon-only control has a tooltip and an `aria-label`, and each icon has one meaning (lexicon below). | Locked |
| **One highlighted item** | A bar or cluster has exactly one selected or filled item. | Locked |
| **Deletions** | Never delete user data implicitly. Previews list every removal; files the user changed or HarnessTap did not write need an explicit confirm listing exact paths. | Locked |
| **Empty states** | Heading, one sentence of why, one action. Search miss is `No matches for "<query>"` plus Clear filter. | Locked |

### Icon lexicon (Lucide, one meaning each)

| Icon | Means | Never use for |
|---|---|---|
| Sparkles | Skill | Plugins, instructions, "new", AI flair |
| Layers | Plugin package | Skills |
| Package | Plugin ref | Plugin packages |
| FileText | Instruction | Generic documents |
| Bot | Agent / Subagent | |
| LayoutGrid | All types | |
| Pencil | Edit | Settings |
| Settings (gear) | Settings | Edit |
| TextQuote | Description field | |
| RefreshCw | Refresh (one per view) | Sync |
| ArrowLeftRight | Sync harnesses | Refresh |
| FileDiff | View changes | |
| Plus | Add / create | Remove |
| Trash2 | Remove or delete (destructive tint) | Clear |
| X | Clear, close, discard one | Delete |
| CircleDashed / CircleAlert | Neutral status, install gap | Skills |

New icon meanings go to Design first as a `design-proposal` (section 9).

## 7. Voice

| Rule | Bad | Good |
|---|---|---|
| No em dashes, en dashes or the single-character ellipsis in any user-facing text (UI, CLI, docs, README). Use a period, comma, colon, parentheses, "to", or three periods. | `Saved` + em dash + `reload to see it` | `Saved. Reload to see it.` |
| Tooltips are short and human. A verb or a noun phrase, not a lecture. | `Refresh live status and rescan tracked directories, this may take a moment.` | `Refresh live status` |
| Not robot. | `Operation completed successfully.` | `Profile applied` |
| Not condescending. No "Simply", "Just", "Please carefully". | `Just click Apply` | `Apply to write these files` |
| One idea per string. A second clause usually means the UI needs a confirm, not a longer tooltip. | | |
| Sentence case for headings and buttons. One noun per concept: profile (the bundle you apply), plugin (one item inside it), Subagent (not Agent). | `DETAILS`, `Agent` | `Details`, `Subagent` |
| Errors say what happened and what to do. No internal words (sidecar, ULID, stack traces) in the first line. | `Sidecar connection failed` | `Can't reach the HarnessTap agent.` |

## 8. Motion

- Functional, not decorative. Overlays 120 to 180ms, pane swaps 120ms, pressed 80ms. Use the `--duration-*` and `--ease-*` tokens and the recipes in `motion.css`.
- Animate only `transform`, `opacity`, `stroke-dashoffset` and `clip-path`. No layout properties, no large blur.
- No bounces, no springs over 300ms, no parallax, no looping attention animations (spinners and skeleton shimmer excepted).
- `prefers-reduced-motion: reduce` shows final states with no movement.
- Scroll-linked effects (docs and marketing only) are never scroll-jacked: native scroll speed, no forced snap, nothing pinned on mobile.

## 9. Working with this system

**Before any UI or copy change:** read this file and the matching section of `apps/desktop/DESIGN.md`, then run the design review checklist (`.agents/skills/design-review/SKILL.md`).

**Allowed without asking:** using existing tokens, components, icons and copy patterns as written here.

**Needs a Design proposal first:** a new token or hex, a new component or pattern, a new icon meaning, a second path for an existing action, a change to a Locked rule.

**The `design-proposal` convention:**
1. Open a draft PR or an issue with the `design-proposal` label. Title: `design-proposal: <short name>`.
2. Body: the problem, two or three options, a recommendation, and screenshots (both themes where supported).
3. Design reviews it and the maintainer decides. A decision becomes a row in `docs/design-decisions.md`.
4. Do not ship the new pattern in the same PR as the feature. Ship the feature without it, or hold the PR until the proposal is decided.

**Changing a token:** update `design-tokens.json`, the CSS token file and `src/ui/theme.ts` together, run the checks below, and update the same hex in every other HarnessTap copy (tokens are duplicated on purpose; there is no shared package).

## 10. Enforcement

| Check | Command | Fails on |
|---|---|---|
| CSS token lint | `bun run lint:css` | Hex, `rgba()`, `font-size`, `z-index` literals in feature CSS |
| Raw color lint | `bun scripts/check-raw-hex.mjs` | Hex or numeric `rgb()`/`hsl()` in TS/TSX strings outside token files |
| Copy lint (G3) | `bun run check:copy` | U+2014, U+2013, U+2026 in user-facing strings and docs |
| Token drift | `bun scripts/check-token-drift.mjs` | CSS token file or snapshot disagreeing with `design-tokens.json` |
| Contrast | `bun scripts/check-contrast.mjs` | Any token pair under 4.5:1 (text) or 3:1 (UI) |

All run in `bun run preflight` and CI. Escape hatches (`token-lint: allow`, allowlist files) need a reason in the PR description and are expected to stay empty.
