# Design decisions

Dated log of HarnessTap design decisions. Agents: check here before reopening a choice. A Locked item changes only with a new reason and the maintainer's yes, through a `design-proposal` (draft PR or issue with that label). Add a new row rather than editing an old one.

- **Locked**: decided by the maintainer. Build it.
- **Proposed**: recommended by Design, waiting for the maintainer. Do not ship it unless a task explicitly asks. (None open as of 2026-11-09.)
- Dates are the day the decision was recorded (Pacific/Tahiti). `~` means the exact day was not recorded.


## Color and tokens

| Date | Decision | Status | Why |
|---|---|---|---|
| 2026-11-09 | Split brand from action: `#3B82F6` stays the brand (mark, Flow Split middle, focus ring); filled actions use `#2563EB`, hover `#1D4ED8`, white text, ring `#3B82F6`. Shipped in [harnesstap#646](https://github.com/harnesstap/harnesstap/pull/646). | Locked | White on `#3B82F6` is 3.68:1 and fails AA; `#2563EB` is 5.17:1 and reads as the same blue, pressed. |
| 2026-11-09 | Status pairs (success, warning, danger, info; tinted text on its own background, light and dark). Shipped in [harnesstap#646](https://github.com/harnesstap/harnesstap/pull/646), except Desktop dark success text (`--green` `#14B8A6` to `#2DD4BF`, tracked). | Locked | Every status reads at 4.5:1 or better on every surface, with one recipe. |
| 2026-11-09 | Links `#60A5FA` / hover `#93C5FD` on dark, `#2563EB` / `#1D4ED8` on light. Shipped in [harnesstap#646](https://github.com/harnesstap/harnesstap/pull/646). | Locked | Brand blue as text on dark raised is 4.29:1; these pass everywhere. |
| 2026-11-09 | Violet fill under white text is `#7C3AED`. Teal never sits under white text; use `#0F766E`. No gradient fill behind white text. | Locked | White on `#8B5CF6` is 4.23:1 and on `#14B8A6` 2.49:1. |
| 2026-11-09 | Danger fill `#DC2626` only on the destructive dialog's confirm; everywhere else the tinted danger pair. | Locked | A red fill should mean "this deletes", nothing else. |
| ~2026-11 | Tokens are duplicated in each repo (`design-tokens.json` plus CSS), not shared as a package. Drift is caught in CI. | Locked | No publish or version step for a few dozen hexes; each repo builds alone. |
| 2026-11-09 | Shared palette adopted: concrete hexes for hover, overlay, selected, border-strong and border-control in both themes, instead of `color-mix()` recipes. | Locked | Every surface copies identical values, and contrast can be checked. |
| 2026-11-09 | Muted text `#475569` on light and `#94A3B8` on dark. | Locked | `#64748B` sat on the AA line (4.34:1 on light raised); both new values pass on every surface. |
| 2026-11-09 | Keep the cool blue-grey dark ramp (`#0F1419`, `#161B22`, `#1C2330`, `#2A3340`) as the one dark palette. | Locked | One dark product instead of two blues; same hue family as the light slate ramp. |
| 2026-11-09 | CLI filled badges use `#2563EB`. | Locked | Same action hex everywhere. |

## Registers and theme

| Date | Decision | Status | Why |
|---|---|---|---|
| ~2026-11 | Two registers share colors and voice: Ops (Desktop, CLI: IBM Plex, 4px, dense) and Brand (harnesstap.com: Onest plus Bricolage, pills, generous spacing). | Locked | The tool stays tight, the website stays warm, and they still look like one company. |
| 2026-11-09 | Desktop stays IBM Plex and 4px. | Locked | Dense ops tool; the shape is part of its identity. |
| ~2026-11 | Marketing bands follow the theme; no forced dark bands. | Locked | A light visitor should not get a navy slab mid-page. |
| ~2026-11 | Exactly one highlighted item in any top bar. | Locked | Two highlights mean neither is the current page. |
| 2026-11-09 | Light, Dark and System themes on Desktop; default System; key `harnesstap-theme`; the control lives only in Desktop Settings. | Locked | Users on a light OS are not dropped into a different world. The header stays free of a second control. |
| 2026-11-09 | Ship order: action tokens first (done), Desktop Light and System last. | Locked | Smallest, safest change first; each step is reviewable alone. |

## UX

| Date | Decision | Status | Why |
|---|---|---|---|
| 2026-08-27 | Quiet icon buttons that open a confirm modal (reason, then confirm) instead of inline action stacks. Example: Archive a version (API keeps `yank`). | Locked | Calm rows; destructive intent is deliberate. |
| 2026-09-10 | Global / Project is a quieter Scope segment, separate from the destination tabs. | Locked | Scope is a filter on the profile view, not a place. |
| 2026-09-10 | Icon-only chrome needs a one-meaning icon lexicon and tooltips. Sparkles means skill only. | Locked | Icons without labels only work if each one means one thing. |
| 2026-09-11 | Lean UI: one path per action. No dual Apply; no status words next to tint plus counts. | Locked | Two controls for one job make users wonder which one is right. |
| 2026-09-12 | Type tabs are pills everywhere: icon, then count, then type text; wrap when needed. No icon-only compact mode. | Locked | Readable counts beat saved width. |
| 2026-09-13 | Profile Apply lives only in the sidebar rail. Preview swaps the main pane; no section-level Apply. | Locked | One Apply, one place. |
| 2026-09-13 | Type tab attention is an amber dot on the tab corner, not a tinted tab. | Locked | Signals "needs review" without shouting. |
| 2026-10-06 | Per-resource harness scope: All is silent; a subset shows up to 3 harness icons plus `+N` opening a "Use on" popover (Select all, None); zero checked reverts on close; All stored as a sentinel; shared-folder harnesses are one row; hidden at 0 or 1 harness. | Locked | The common case (All) adds no chrome; exceptions are visible. |
| 2026-10-09 | Never delete user data implicitly. Previews list every removal; changed or unmanaged files need an explicit confirm with exact paths. | Locked | Trust: HarnessTap only removes what it wrote. |
| 2026-11-09 | Zero-count types never hide in Library. They render as a muted pill with `0` and a short tooltip ("No plugins in your library yet"). | Locked | Users see that a type exists and is empty, and can switch to it, without noisy "No Plugins found" labels. |
| 2026-11-09 | New tokens, patterns, icon meanings, second paths or changes to a Locked rule go through a `design-proposal`: a draft PR or issue with that label, decided before the feature ships it. | Locked | Keeps the system deliberate and gives agents one route for new ideas. |

## Voice

| Date | Decision | Status | Why |
|---|---|---|---|
| 2026-10-09 | No em dashes, en dashes or the single-character ellipsis in any user-facing text: CLI, Desktop, website, docs, README. Code comments exempt. Enforced by the copy lint. | Locked | Plain punctuation that reads the same in a terminal and a tooltip. |
| ~2026-09 | Tooltips are short and human: not prose, not robot, not condescending. One idea per string. | Locked | Tooltips are labels, not documentation. |
| ~2026-11 | Glossary: a profile is the bundle you apply, a plugin is one item inside it, the catalog is where profiles are published. Say "plugin", not "layer". | Locked | One noun per concept across every surface. |

## Website and motion

| Date | Decision | Status | Why |
|---|---|---|---|
| ~2026-08-27 | No Product link in the header or footer. Signed-out header: Concepts, Catalog, Pricing, Docs. Signed-in account is an initials disc. | Locked | Concepts does the product explanation; fewer, clearer paths. |
| 2026-08-28 | Unsloth-style download CTA: detected-OS primary plus a "Choose your platform" dropdown, in the hero (Start free stays primary) and compact in the header. Not a "Download" text link. | Locked | The right installer in one click; other platforms one click away. |
| ~2026-08-27 | Pricing: Personal carries "Start here"; no "Most popular" on Pro. | Locked | Point new users at the free path honestly. |
| 2026-08-27 | `/concepts` panels: same size, top-aligned, centered copy, shared radius, no fade. | Locked | The copy and the diagram read as one unit. |
| 2026-11-09 | `/concepts` v2: equal two-panel sticky shell, OpenCode in Act 0, v1 fixes folded into v2. | Locked | Approved storyboard direction. |
| 2026-11-09 | Scroll motion: scroll-linked, never scroll-jacked; animate only transform, opacity, stroke-dashoffset and clip-path; reduced motion shows final states; nothing pinned on mobile, each act plays once with Replay. | Locked | Readers keep control of the page; it stays fast and accessible. |
