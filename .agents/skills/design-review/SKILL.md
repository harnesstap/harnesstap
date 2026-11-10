---
name: design-review
description: Pre-PR design review for any HarnessTap UI, CLI output or user-facing copy change. Use before opening or updating a PR that touches styles, components, pages, tooltips, error messages, docs or design tokens.
---

# Design review

Run this before you open a PR that changes anything a user sees. It takes about ten minutes. Fix what fails, or say in the PR why an item does not apply.

## 0. Load the rules

1. Read the repo's `DESIGN.md`. Also read any per-screen reference it points to (for example `apps/desktop/DESIGN.md`) and `PRODUCT.md` if the repo has one.
2. Skim `docs/design-decisions.md`. If your change touches a Locked decision, stop and write a proposal instead. If it builds a Proposed item, check that the task explicitly asked for it.
3. List the surfaces you changed and find each one in the `DESIGN.md` surface table (section 1).

## 1. Run the checks

```bash
bun run preflight                                  # includes the CSS token lint and the copy lint
bun scripts/check-raw-hex.mjs --changed-since origin/main
bun scripts/check-token-drift.mjs                  # if you touched any token file
bun scripts/check-contrast.mjs                     # if you touched any token file
```

All must pass. Do not add allowlist entries or `token-lint: allow` without a reason in the PR description.

## 2. Checklist

Answer each line yes, no or n/a. Any "no" is a fix or a proposal.

### Tokens and color
- [ ] Every color, size, radius, shadow, z-index and duration comes from a token. No new hex.
- [ ] Filled primary buttons use the action token (`#2563EB`, white text, hover `#1D4ED8`). Only one filled primary per action cluster.
- [ ] No white text on brand blue `#3B82F6`, teal `#14B8A6`, violet `#8B5CF6` or `#EF4444`. No gradient behind text.
- [ ] Blue text on dark surfaces uses the link token, not the action or brand blue.
- [ ] Danger fill appears only on the confirm button of a destructive dialog. Other danger uses the tinted pair.
- [ ] Status is never color alone: there is a label or an icon too.
- [ ] Checked in both light and dark where the surface supports both.

### Surface
- [ ] Each changed surface uses the type, radius and density that `DESIGN.md` section 1 gives it. Colors are shared; shape is not.
- [ ] Ops surfaces: IBM Plex, 4px radius, dense spacing, no glass cards or pill CTAs.
- [ ] Brand surfaces: Onest and Bricolage, pill CTAs, generous spacing, one primary action per section.

### UX
- [ ] One path per action. No second button, menu item or shortcut that does the same job without a clear reason.
- [ ] No status words that repeat what a tint or count already says.
- [ ] Destructive or disk-changing actions are a quiet icon that opens a confirm: reason first, then the confirm button. The confirm lists exact files or items when data is removed.
- [ ] Library type tabs never hide zero-count types (muted `0` pill with a tooltip).
- [ ] Every icon-only control has a tooltip and an `aria-label`. Each icon keeps its single meaning (Sparkles is skill only, Pencil is edit, the gear is settings).
- [ ] Exactly one highlighted item in each nav bar or segmented control.
- [ ] Empty states: a heading, one sentence of why, one action. Search misses say `No matches for "<query>"` with Clear filter.
- [ ] Keyboard: focus is visible (blue ring), Esc closes the top layer, focus returns to the opener.

### Copy
- [ ] No em dash, en dash or single-character ellipsis in any user-facing string, doc or README.
- [ ] Tooltips are a short verb or noun phrase. No lecture, no "Simply" or "Just", no robot phrasing like "Operation completed successfully".
- [ ] Sentence case for headings and buttons. One noun per concept (profile, plugin, Subagent).
- [ ] Errors say what happened and what to do, in one line, without internal words.
- [ ] Counts use the plural helper (`1 skill`, `2 skills`).

### Motion
- [ ] Only transform, opacity, stroke-dashoffset or clip-path animate. Durations come from tokens.
- [ ] Reduced motion shows final states with no movement.
- [ ] Scroll effects are scroll-linked, never scroll-jacked, and nothing is pinned on mobile.

### Accessibility
- [ ] Text contrast at least 4.5:1, UI boundaries and focus rings at least 3:1.
- [ ] Hit targets at least 32px (24px for trailing chip actions).
- [ ] Automated axe run has no serious or critical issues.

## 3. Evidence in the PR

- Before and after screenshots of each changed surface (both themes where supported, and narrow width for public pages).
- The checklist result: paste only the "no" and "n/a" lines with one-line reasons.
- If anything new was needed (token, component, icon meaning, a second path, a changed Locked rule), link the `design-proposal` issue or draft PR instead of shipping it here.

## 4. When to stop and propose

Stop and open a `design-proposal` when:
- the design you need is not covered by `DESIGN.md`,
- two rules conflict, or `DESIGN.md` disagrees with a screen lockfile,
- a check only passes with an allowlist entry.

How to open one:
1. A draft PR or an issue with the `design-proposal` label, titled `design-proposal: <short name>`.
2. Body: the problem, two or three options, a recommendation, screenshots (both themes where supported).
3. Link it from your feature PR. Design reviews it and the maintainer decides; the decision becomes a row in `docs/design-decisions.md`.

Until then, ship the feature without the new pattern or hold the PR.
