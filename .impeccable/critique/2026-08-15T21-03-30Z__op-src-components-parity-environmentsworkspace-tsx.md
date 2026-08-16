---
target: environment view
total_score: 18
p0_count: 0
p1_count: 3
timestamp: 2026-08-15T21-03-30Z
slug: op-src-components-parity-environmentsworkspace-tsx
---
# Environments workspace critique

Target: apps/desktop/src/components/parity/EnvironmentsWorkspace.tsx

## Heuristics
1 Visibility 2 — active list badge works; no selected-row chrome; detail has no loading skeleton
2 Real world 2 — Apply means environment use, not ht apply; plugin names look like dead copy
3 Control 3 — delete confirm + force checkbox; no undo after Apply
4 Consistency 1 — 44px labeled .btn in a chrome that is otherwise 32px icon-action
5 Error prevention 3 — destructive confirm is solid
6 Recognition 2 — reverse plugin refs cannot be followed
7 Flexibility 1 — no deep link, no keyboard accelerators, no auto-select
8 Aesthetic 1 — stacked h3 + None document, not harness-block / definition list
9 Recovery 2 — error banner only
10 Help 1 — panel subtitle is the only orientation

Total 18/40 Poor

## Detector
detect.mjs --json on EnvironmentsWorkspace.tsx: [] (clean). Browser overlay skipped: Tauri webview, screenshot used.

## Priority issues
P1 Header actions use full-width .btn (min-height 44px) instead of icon-action
P1 Detail is six equal h3 sections; empty categories keep full visual weight
P1 Plugin names are static text with no navigation to Library → Packages
P2 Sidebar uses underlined resource-name-btn (link affordance) and has no selected state
P2 Apply copy collides with package Apply (ht apply vs environment use)
