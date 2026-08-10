# TODOS

## Design debt (from /plan-design-review 2026-07-25)

### T-DESIGN-1 — Lightweight DESIGN.md for Tauri desktop UI
- **What:** Add `DESIGN.md` (or `docs/ui-design.md`) in harnesstap by lifting the Visual language section from the Persona Control Plane design doc.
- **Why:** Repo-local source of truth for dark ops tokens, typography, and anti-slop rules so implementers don’t invent Inter/purple defaults in the Tauri webview UI.
- **Pros:** Cheap; prevents visual drift across PRs.
- **Cons:** Temporary dual docs vs Cloud until a later brand unify.
- **Context:** Locked in plan-design-review Pass 5; GUI shell amended to Tauri-first; full `/design-consultation` deferred until after local dogfood.
- **Depends on / blocked by:** Phase 1 UI scaffolding kickoff.
- **Status:** deferred (track here; create file when UI work starts)

### T-DESIGN-2 — WCAG 2.2 AA audit for desktop UI (post-MVP)
- **What:** Full WCAG 2.2 AA pass on the Tauri-embedded UI (screen readers, dialog focus traps, contrast recheck, reduced motion).
- **Why:** Coworker-facing Phase 3 should not inherit mouse-only / incomplete a11y from founder dogfood.
- **Pros:** Clear quality gate before sharing; builds on MVP keyboard baseline already locked.
- **Cons:** Real calendar time; needs shipped UI first.
- **Context:** Pass 6 locked MVP keyboard/focus/labels; full audit explicitly deferred.
- **Depends on / blocked by:** Phase 1 Tauri GUI shipping.
- **Status:** deferred (Phase 1.1 / pre-coworker)

### T-DESIGN-3 — Live panel: rules/skills (Phase 1.1)
- **What:** Extend live-state JSON + UI for rules/skills with installed|missing|extra (same pattern as plugins/MCP).
- **Why:** “Panel green” should eventually cover the full persona stack, not only plugins/MCP.
- **Pros:** Completes live confidence; already anticipated in the APPROVED plan.
- **Cons:** Density risk; more aggregation work.
- **Context:** Phase 1 MVP fields explicitly deferred rules/skills to 1.1.
- **Depends on / blocked by:** Phase 1 plugins/MCP live panel shipping.
- **Status:** deferred (Phase 1.1)

### T-DESIGN-4 — In-GUI “New profile” wizard
- **What:** In-GUI flow to name a profile and compose/import pins without dropping to CLI.
- **Why:** Empty-rail CTA previously sent founders to CLI/docs; wizard keeps first-run in-browser.
- **Pros:** Lower empty-state friction for non-CLI-comfortable users later.
- **Cons:** Duplicates CLI/Cloud authoring; scope must stay bounded vs full authoring.
- **Context:** Shipped in desktop GUI (`CreateProfileDrawer`: compose, from-home, from-project, preview, conflict policy).
- **Depends on / blocked by:** —
- **Status:** done (2026-07-25)

## Eng debt (from /plan-eng-review 2026-07-25)

### T-ENG-1 — Plugin uninstall/disable on PluginProvider
- **What:** Add uninstall/disable to `PluginProvider` (Claude Code first; Cursor if applicable) and optionally wire into persona switch teardown.
- **Why:** Phase 1 teardown only removes owned files/MCP; leftover host plugins show as `extra` forever and can’t be cleaned by HarnessTap.
- **Pros:** Stronger “this persona is what’s live” for coworker Phase 3; closes known CEO gap.
- **Cons:** Host CLI uninstall APIs are messy; must not block Phase 1 dogfood.
- **Context:** `src/plugins/types.ts` has install/update/list/check only. Eng review D7 locked honest file/MCP teardown. Green still allowed with `extra` rows per design.
- **Depends on / blocked by:** Phase 1 switch + live panel shipping; dogfood evidence that extras hurt.
- **Effort:** L
- **Priority:** P2
- **Status:** deferred

### T-ENG-2 — Expand file lock to all DB-mutating commands
- **What:** Extend the profile-apply file lock (or a broader workspace lock) to cover other DB writers (`plugin` edit/scan, `resource sync`, profile create/delete, etc.) while the Tauri sidecar holds a long-lived DB connection.
- **Why:** Phase 1 only locks mutating profile applies + `busy_timeout`; concurrent CLI mutations can still race the sidecar (outside voice / D20 deferral).
- **Pros:** Fewer SQLITE races and corrupt reads when terminal + desktop are both used.
- **Cons:** Wide blast radius; risk of over-locking or deadlocks if applied naively.
- **Context:** Eng review D20: `PRAGMA busy_timeout` + dual-runtime WAL smoke in Phase 1; global mutation lock deferred until dogfood evidence.
- **Depends on / blocked by:** Sidecar shipping; observed non-apply races in dogfood.
- **Effort:** M–L
- **Priority:** P2
- **Status:** deferred

### T-ENG-3 — Content checkpoint restore (if re-apply proves weak)
- **What:** Stronger than re-apply restore: content checkpoint / bit-identical undo of harness home files when switch failure recovery needs it.
- **Why:** Phase 1 restore is honest re-apply of the previous profile (CEO E7 / eng D17). If dogfood shows re-apply leaves bad host state, need a harder undo.
- **Pros:** Escape hatch for scary half-stack recoveries.
- **Cons:** Storage + complexity; premature before evidence.
- **Context:** Listed in CEO known gaps; eng review kept re-apply for Phase 1. Do not build unless dogfood fails.
- **Depends on / blocked by:** Phase 1 switch dogfood; evidence re-apply insufficient.
- **Effort:** L
- **Priority:** P3
- **Status:** deferred


